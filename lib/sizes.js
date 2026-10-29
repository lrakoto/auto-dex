// Size comparison for the compare page (R11): each car's overall length,
// width and height from Wikidata, drawn to one scale. Pure — the view turns
// this into two SVGs whose coordinates are millimetres, so a shared scale is
// just a shared unit.
//
// Wikidata gives the bounding box, not a body shape, so the outlines are
// rounded boxes: honest about what the numbers say, and still enough to see
// which car is longer, wider or taller.

const PAD_MM = 120; // breathing room around the drawing, in drawing units

// `cars`: [{ make, model, dims: { length, width, height } }] with millimetres
// or null. Returns null when no car can be drawn in either view.
function sizeComparison(cars) {
  const entries = cars.map((car, index) => ({
    index,
    label: `${car.make} ${car.model}`,
    length: (car.dims && car.dims.length) || null,
    width: (car.dims && car.dims.width) || null,
    height: (car.dims && car.dims.height) || null
  }));
  const sideCars = entries.filter(e => e.length && e.height);
  const frontCars = entries.filter(e => e.width && e.height);
  if (!sideCars.length && !frontCars.length) return null;

  // One height for both views, so the side and front drawings share a scale
  const tallest = Math.max(...entries.map(e => e.height || 0));
  const viewHeight = tallest + 2 * PAD_MM;
  const ground = tallest + PAD_MM;

  // Biggest first, so smaller outlines are drawn on top and stay visible
  const byArea = (a, b) => b.area - a.area;

  const side = sideCars.length ? (() => {
    const longest = Math.max(...sideCars.map(e => e.length));
    return {
      width: longest + 2 * PAD_MM,
      height: viewHeight,
      ground,
      pad: PAD_MM,
      cars: sideCars.map(e => ({
        index: e.index,
        x: PAD_MM,
        y: ground - e.height,
        w: e.length,
        h: e.height,
        area: e.length * e.height
      })).sort(byArea)
    };
  })() : null;

  const front = frontCars.length ? (() => {
    const widest = Math.max(...frontCars.map(e => e.width));
    const centre = PAD_MM + widest / 2;
    return {
      width: widest + 2 * PAD_MM,
      height: viewHeight,
      ground,
      pad: PAD_MM,
      cars: frontCars.map(e => ({
        index: e.index,
        x: centre - e.width / 2,
        y: ground - e.height,
        w: e.width,
        h: e.height,
        area: e.width * e.height
      })).sort(byArea)
    };
  })() : null;

  return {
    side,
    front,
    legend: entries.map(e => ({
      index: e.index,
      label: e.label,
      length: e.length,
      width: e.width,
      height: e.height,
      drawn: !!((e.length || e.width) && e.height)
    }))
  };
}

// "4,694 × 2,088 × 1,436 mm" with "?" for a missing dimension
function formatDims({ length, width, height }) {
  const n = v => (v ? v.toLocaleString('en-US') : '?');
  return `${n(length)} × ${n(width)} × ${n(height)} mm`;
}

module.exports = { sizeComparison, formatDims, PAD_MM };
