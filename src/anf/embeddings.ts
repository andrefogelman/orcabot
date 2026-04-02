// src/embeddings.ts
import { supabase } from '../supabase-client.js';
import { logActivity } from './activity-log.js';

const CHUNK_SIZE = 500; // ~500 words per chunk
const CHUNK_OVERLAP = 50;

interface DocumentChunk {
  title: string;
  content: string;
  agent_id: string;
  doc_type: string;
  metadata: Record<string, unknown>;
}

export function chunkText(
  text: string,
  chunkSize: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP,
): string[] {
  const words = text.split(/\s+/);
  if (words.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    chunks.push(words.slice(start, end).join(' '));
    start = end - overlap;
    if (start >= words.length - overlap) break;
  }
  return chunks;
}

export async function ingestDocument(params: {
  agent_id: string;
  title: string;
  content: string;
  doc_type: string;
  file_path?: string;
}): Promise<number> {
  const chunks = chunkText(params.content);
  let inserted = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkTitle =
      chunks.length > 1
        ? `${params.title} [parte ${i + 1}/${chunks.length}]`
        : params.title;
    const { error } = await supabase.from('nano_documents').insert({
      agent_id: params.agent_id,
      title: chunkTitle,
      content: chunks[i],
      doc_type: params.doc_type,
      file_path: params.file_path,
      metadata: {
        chunk_index: i,
        total_chunks: chunks.length,
        original_title: params.title,
      },
    });
    if (!error) inserted++;
  }

  await logActivity({
    agent_id: params.agent_id,
    action: 'write',
    target_table: 'nano_documents',
    description: `Documento ingerido: "${params.title}" (${inserted} chunks)`,
  });

  console.log(
    `[embeddings] Ingested "${params.title}": ${inserted}/${chunks.length} chunks`,
  );
  return inserted;
}

export async function searchDocuments(
  agent_id: string,
  query: string,
  limit: number = 5,
): Promise<
  Array<{ title: string; content: string; doc_type: string; relevance: number }>
> {
  // Full-text search using PostgreSQL tsvector
  // Search across title and content
  const searchTerms = query
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 10)
    .map((w) => w.replace(/[^a-zA-ZÀ-ÿ0-9]/g, ''))
    .filter(Boolean)
    .join(' | ');

  if (!searchTerms) {
    // Fallback: return most recent docs for this agent
    const { data } = await supabase
      .from('nano_documents')
      .select('title, content, doc_type')
      .eq('agent_id', agent_id)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data || []).map((d) => ({ ...d, relevance: 0.5 }));
  }

  // Try text search first
  const { data, error } = await supabase
    .from('nano_documents')
    .select('title, content, doc_type')
    .eq('agent_id', agent_id)
    .or(
      `title.ilike.%${searchTerms.split(' | ')[0]}%,content.ilike.%${searchTerms.split(' | ')[0]}%`,
    )
    .limit(limit);

  if (error || !data?.length) {
    // Fallback: return most recent
    const { data: fallback } = await supabase
      .from('nano_documents')
      .select('title, content, doc_type')
      .eq('agent_id', agent_id)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (fallback || []).map((d) => ({ ...d, relevance: 0.3 }));
  }

  return data.map((d) => ({ ...d, relevance: 0.8 }));
}

export async function searchMemories(
  agent_id: string,
  query: string,
  limit: number = 20,
): Promise<
  Array<{
    title: string;
    content: string;
    category: string;
    relevance_score: number;
  }>
> {
  // First: get pinned memories (always included)
  const { data: pinned } = await supabase
    .from('nano_memory')
    .select('title, content, category, relevance_score')
    .eq('agent_id', agent_id)
    .eq('pinned', true);

  // Then: search by relevance score + text match
  const searchTerms = query
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 5);
  let queryBuilder = supabase
    .from('nano_memory')
    .select('title, content, category, relevance_score')
    .eq('agent_id', agent_id)
    .eq('pinned', false)
    .order('relevance_score', { ascending: false })
    .limit(limit);

  // If we have search terms, filter by content/title match
  if (searchTerms.length > 0) {
    const term = searchTerms[0];
    queryBuilder = supabase
      .from('nano_memory')
      .select('title, content, category, relevance_score')
      .eq('agent_id', agent_id)
      .eq('pinned', false)
      .or(`title.ilike.%${term}%,content.ilike.%${term}%`)
      .order('relevance_score', { ascending: false })
      .limit(limit);
  }

  const { data: scored } = await queryBuilder;

  // Merge pinned + scored, deduplicate
  const all = [...(pinned || []), ...(scored || [])];
  const seen = new Set<string>();
  return all
    .filter((m) => {
      const key = m.title + m.content;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
