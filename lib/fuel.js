// Fuel log stats assume full-to-full fill-ups. Each interval uses the gallons
// and price at its ending fill. The first fill establishes the starting mileage.
function fuelStats(logs) {
  const sorted = [...logs].sort((a, b) => a.odometer - b.odometer);
  let milesDriven = 0;
  let gallonsForMiles = 0;
  let costForMiles = 0;
  let allMeasuredFillsPriced = true;
  let totalCost = 0;
  let totalGallons = 0;
  let costCount = 0;

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const gallons = Number(entry.gallons);
    const cost = entry.cost == null ? null : Number(entry.cost);
    totalGallons += gallons;
    if (cost !== null) {
      totalCost += cost;
      costCount++;
    }
    if (i > 0) {
      milesDriven += entry.odometer - sorted[i - 1].odometer;
      gallonsForMiles += gallons;
      if (cost === null) allMeasuredFillsPriced = false;
      else costForMiles += cost;
    }
  }

  return {
    fillUps: sorted.length,
    milesDriven,
    totalGallons,
    totalCost: costCount ? totalCost : null,
    pricedFillUps: costCount,
    avgMpg: gallonsForMiles > 0 ? milesDriven / gallonsForMiles : null,
    costPerMile: milesDriven > 0 && allMeasuredFillsPriced ? costForMiles / milesDriven : null
  };
}

module.exports = { fuelStats };
