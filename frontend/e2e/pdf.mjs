export // A real multi-page PDF built by hand. Page n has n black squares, so every page looks different.
function makePdf(pages) {
  const objs = [];
  const add = (body) => objs.push(body) && objs.length;
  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  const kids = Array.from({ length: pages }, (_, i) => 4 + i * 2);
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pages} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"); // object 3
  for (let n = 1; n <= pages; n++) {
    let draw = "BT /F1 48 Tf 60 720 Td (PAGE " + n + ") Tj ET\n";
    for (let k = 0; k < n; k++) draw += `${60 + k * 70} 500 50 50 re f\n`;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + (n - 1) * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    add(`<< /Length ${draw.length} >>\nstream\n${draw}endstream`);
  }
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
