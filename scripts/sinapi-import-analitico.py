#!/usr/bin/env python3
"""
Import SINAPI Analítico (composições detalhadas com insumos e coeficientes)
from the official SINAPI_Referência Excel into ob_sinapi_composicao_insumos.

Usage: python3 scripts/sinapi-import-analitico.py
"""
import openpyxl
import re
import os
from supabase import create_client

# Load env
env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
with open(env_path) as f:
    for line in f:
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ[k.strip()] = v.strip().strip('"')

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

XLSX = "/tmp/sinapi-check/SINAPI-2026-02-formato-xlsx/SINAPI_Referência_2026_02.xlsx"

# Step 1: Build codigo → id lookup from ob_sinapi_composicoes (SP only)
print("Building codigo → id lookup...")
lookup = {}
offset = 0
while True:
    resp = sb.from_("ob_sinapi_composicoes") \
        .select("id, codigo") \
        .eq("uf", "SP") \
        .range(offset, offset + 999) \
        .execute()
    if not resp.data:
        break
    for row in resp.data:
        lookup[str(row["codigo"])] = row["id"]
    offset += len(resp.data)
    if len(resp.data) < 1000:
        break

print(f"Lookup: {len(lookup)} codes")

# Step 2: Parse Analítico sheet
print("Loading Excel...")
wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=False)
ws = wb["Analítico"]

# Row 10 = headers: Grupo | Código da Composição | Tipo Item | Código do Item | Descrição | Unidade | Coeficiente | Situação
# Rows without Tipo Item = composition header
# Rows with Tipo Item (COMPOSICAO/INSUMO) = items belonging to parent

print("Parsing Analítico sheet...")
records = []
current_comp_codigo = None
current_comp_id = None
skipped_no_parent = 0
skipped_no_insumo = 0

for row in ws.iter_rows(min_row=11, values_only=True):
    tipo_item = row[2]  # COMPOSICAO or INSUMO or empty (parent)

    if not tipo_item:
        # Parent composition row
        comp_codigo = str(row[1]).strip() if row[1] else None
        if comp_codigo:
            # Extract code from HYPERLINK formula if needed
            match = re.search(r'(\d{4,6})', comp_codigo)
            if match:
                comp_codigo = match.group(1)
            current_comp_codigo = comp_codigo
            current_comp_id = lookup.get(comp_codigo)
    else:
        # Insumo/sub-composição row
        if not current_comp_id:
            skipped_no_parent += 1
            continue

        insumo_codigo_raw = str(row[3]).strip() if row[3] else None
        if not insumo_codigo_raw:
            continue

        match = re.search(r'(\d{4,6})', insumo_codigo_raw)
        if not match:
            continue
        insumo_codigo = match.group(1)

        insumo_id = lookup.get(insumo_codigo)
        if not insumo_id:
            skipped_no_insumo += 1
            continue

        coef_raw = row[6]
        try:
            coeficiente = float(coef_raw) if coef_raw else 0.0
        except (ValueError, TypeError):
            coeficiente = 0.0

        if coeficiente <= 0:
            continue

        records.append({
            "composicao_id": current_comp_id,
            "insumo_id": insumo_id,
            "coeficiente": coeficiente,
        })

print(f"Parsed {len(records)} insumo records")
print(f"Skipped: {skipped_no_parent} (parent not in DB), {skipped_no_insumo} (insumo not in DB)")

# Step 3: Clear existing data and insert in batches
print("Clearing existing ob_sinapi_composicao_insumos...")
# Delete all existing records
sb.from_("ob_sinapi_composicao_insumos").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

print(f"Inserting {len(records)} records in batches of 500...")
inserted = 0
errors = 0
seen = set()  # Track unique (composicao_id, insumo_id) pairs

for i in range(0, len(records), 500):
    batch = []
    for r in records[i:i+500]:
        key = (r["composicao_id"], r["insumo_id"])
        if key in seen:
            continue  # Skip duplicates
        seen.add(key)
        batch.append(r)

    if not batch:
        continue

    try:
        resp = sb.from_("ob_sinapi_composicao_insumos").insert(batch).execute()
        inserted += len(batch)
    except Exception as e:
        # Try one by one for error handling
        for r in batch:
            try:
                sb.from_("ob_sinapi_composicao_insumos").insert(r).execute()
                inserted += 1
            except Exception as e2:
                errors += 1
                if errors <= 5:
                    print(f"  Error: {e2}")

    if inserted % 2000 == 0:
        print(f"  {inserted} inserted...")

print(f"\nDone!")
print(f"  Inserted: {inserted}")
print(f"  Duplicates removed: {len(records) - len(seen)}")
print(f"  Errors: {errors}")
