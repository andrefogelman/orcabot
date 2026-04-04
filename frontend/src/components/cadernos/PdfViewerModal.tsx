import { useState, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
} from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerModalProps {
  open: boolean;
  onClose: () => void;
  pdfUrl: string;
  title: string;
}

export function PdfViewerModal({
  open,
  onClose,
  pdfUrl,
  title,
}: PdfViewerModalProps) {
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pageInput, setPageInput] = useState("1");

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setCurrentPage(1);
    setPageInput("1");
  }, []);

  const goToPage = useCallback(
    (page: number) => {
      const p = Math.max(1, Math.min(numPages, page));
      setCurrentPage(p);
      setPageInput(String(p));
    },
    [numPages],
  );

  const handlePageInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        const p = parseInt(pageInput, 10);
        if (!isNaN(p)) goToPage(p);
      }
    },
    [pageInput, goToPage],
  );

  const fitToWidth = useCallback(() => {
    setScale(1.0);
  }, []);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[95vh] max-h-[95vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b shrink-0">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="truncate text-base">{title}</DialogTitle>
            <div className="flex items-center gap-2 shrink-0">
              {/* Page navigation */}
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-1">
                <Input
                  className="w-14 h-8 text-center text-sm"
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onKeyDown={handlePageInputKeyDown}
                  onBlur={() => {
                    const p = parseInt(pageInput, 10);
                    if (!isNaN(p)) goToPage(p);
                    else setPageInput(String(currentPage));
                  }}
                />
                <span className="text-sm text-muted-foreground">
                  / {numPages}
                </span>
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= numPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>

              {/* Separator */}
              <div className="w-px h-6 bg-border mx-1" />

              {/* Zoom */}
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setScale((s) => Math.max(0.25, s - 0.25))}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-sm w-12 text-center tabular-nums">
                {Math.round(scale * 100)}%
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setScale((s) => Math.min(4, s + 0.25))}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={fitToWidth}
                title="Ajustar a largura"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>

              {/* Separator */}
              <div className="w-px h-6 bg-border mx-1" />

              {/* Download */}
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                asChild
              >
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer" download>
                  <Download className="h-4 w-4" />
                  Baixar
                </a>
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* PDF content */}
        <div className="flex-1 overflow-auto flex justify-center bg-muted/30 p-4">
          <Document
            file={pdfUrl}
            onLoadSuccess={onLoadSuccess}
            loading={
              <div className="flex items-center justify-center h-64">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            }
            error={
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <p className="text-lg font-medium">Erro ao carregar PDF</p>
                <p className="text-sm">Verifique se o arquivo existe no storage.</p>
              </div>
            }
          >
            <Page
              pageNumber={currentPage}
              scale={scale}
              renderAnnotationLayer
              renderTextLayer
            />
          </Document>
        </div>
      </DialogContent>
    </Dialog>
  );
}
