// Writes two small test PDFs (5 pages each) into a folder, for the Learning e2e test:
//
//   node e2e/make-library.mjs <folder>
//
// Start the API with LIBRARY_DIR=<folder> so it loads them, then run e2e/books.e2e.mjs.
import fs from "node:fs";
import path from "node:path";
import { makePdf } from "./pdf.mjs";

const dir = process.argv[2];
if (!dir) throw new Error("Usage: node e2e/make-library.mjs <folder>");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "01 - Trading_Psychology.pdf"), makePdf(5));
fs.writeFileSync(path.join(dir, "02 - Strategy.pdf"), makePdf(3));
console.log(`Wrote 2 PDFs to ${dir}`);
