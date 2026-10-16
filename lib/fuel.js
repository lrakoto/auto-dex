// Fuel log stats: real-world MPG and cost per mile from a garage car's
// fill-up history. Entries are assumed full-to-full (standard for fuel logs:
// Fuelly, GasBuddy), so a trip's MPG is its distance divided by the gallons
// put in at the *next* fill-up, not the one it started from.
function fuelStats(logs) {
  const sorted = [...logs].sort((a, b) => a.odometer - b.odometer);
  let milesDriven = 0;
  let gallonsForMiles = 0;
  let totalCost = 0;
  let totalGallons = 0;
  let costCount = 0;

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    totalGallons += Number(entry.gallons);
    if (entry.cost != null) {
      totalCost += Number(entry.cost);
      costCount++;
    }
    if (i > 0) {
      milesDriven += entry.odometer - sorted[i - 1].odometer;
      gallonsForMiles += Number(entry.gallons);
    }
  }

  return {
    fillUps: sorted.length,
    milesDriven,
    totalGallons,
    totalCost: costCount ? totalCost : null,
    avgMpg: gallonsForMiles > 0 ? milesDriven / gallonsForMiles : null,
    // Needs every fill-up priced, or the per-mile figure would understate cost
    costPerMile: milesDriven > 0 && costCount === sorted.length ? totalCost / milesDriven : null
  };
}

module.exports = { fuelStats };
