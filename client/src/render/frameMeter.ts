/** Rolling frame-time statistics for the performance budget: mean, p95 and fps over the last N frames. Pure, so it is tested
 * without a browser; the scene feeds it `ticker.deltaMS` and drops its quality tier when `p95` stays high. */
export class FrameMeter {
  private buf: number[] = [];
  constructor(private size = 120) {}

  add(ms: number): void {
    this.buf.push(ms);
    if (this.buf.length > this.size) this.buf.shift();
  }

  get count(): number {
    return this.buf.length;
  }

  get mean(): number {
    return this.buf.length ? this.buf.reduce((a, b) => a + b, 0) / this.buf.length : 0;
  }

  get p95(): number {
    if (!this.buf.length) return 0;
    const s = [...this.buf].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)];
  }

  get max(): number {
    return this.buf.length ? Math.max(...this.buf) : 0;
  }

  get fps(): number {
    return this.mean > 0 ? 1000 / this.mean : 0;
  }
}
