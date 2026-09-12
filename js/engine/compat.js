// Small browser fallbacks. CanvasRenderingContext2D.roundRect shipped in Safari 16 / Chrome 99 / Firefox 112;
// without it every scene build (hub decals, ping labels) would throw on iOS 15 devices that otherwise run WebGL2 fine.
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r = 0) {
    const rad = Math.max(0, Math.min(Array.isArray(r) ? Number(r[0]) || 0 : Number(r) || 0, Math.abs(w) / 2, Math.abs(h) / 2));
    this.moveTo(x + rad, y); this.arcTo(x + w, y, x + w, y + h, rad); this.arcTo(x + w, y + h, x, y + h, rad);
    this.arcTo(x, y + h, x, y, rad); this.arcTo(x, y, x + w, y, rad); this.closePath(); return this;
  };
}
export {};
