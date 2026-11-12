// Sample the live WebGL canvas into an ASCII luminance grid.
// Run inside the page via evaluate_script; returns { rows, cols, art }.
(() => {
  const src = document.querySelector("canvas");
  if (!src) return null;
  const cols = 78, rows = 42;
  const c = document.createElement("canvas");
  c.width = cols; c.height = rows;
  const cx = c.getContext("2d", { willReadFrequently: true });
  cx.drawImage(src, 0, 0, cols, rows);
  const d = cx.getImageData(0, 0, cols, rows).data;
  const ramp = " .:-=+*#%@";
  const lines = [];
  for (let y = 0; y < rows; y++) {
    let line = "";
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      line += ramp[Math.min(9, Math.floor(lum * 10))];
    }
    lines.push(line);
  }
  return { rows, cols, art: lines };
})()
