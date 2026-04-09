declare module 'pdf-parse/lib/pdf-parse.js' {
  import type { Result } from 'pdf-parse';
  function pdfParse(dataBuffer: Buffer): Promise<Result>;
  export default pdfParse;
}
