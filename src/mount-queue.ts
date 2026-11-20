/** Start visible icons first, with a task boundary between small batches. */
export function mountInSlices(icons: SVGSVGElement[], mount: (svg: SVGSVGElement) => void): () => void {
  const visible = new Map(icons.map((svg) => {
    const r = svg.getBoundingClientRect();
    return [svg, r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth];
  }));
  icons.sort((a, b) => Number(visible.get(b)) - Number(visible.get(a)));
  let index = 0;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  const run = () => {
    const start = performance.now();
    do {
      if (cancelled || index === icons.length) return;
      const svg = icons[index++];
      if (svg.isConnected) mount(svg);
    } while (performance.now() - start < 4);
    timer = setTimeout(run, 0);
  };
  timer = setTimeout(run, 0);
  return () => { cancelled = true; clearTimeout(timer); };
}
