// "Find one for sale" links on the car detail page (R14): search pages on
// marketplaces, by make and model. Only destinations whose search URL was
// checked to land on matching listings (2026-10-29) are here:
//  - Bring a Trailer: its search redirects to the model's page, rare cars
//    included (Lancia Flavia); it auctions cars and motorcycles.
//  - Autotrader: the keyword search filters its US listings; cars only.
// Cars.com and eBay Motors refuse scripted checks (bot walls), so they are
// left out until someone verifies them in a browser.

function saleLinks(make, model, type = 'car') {
  const query = `${make} ${model}`;
  const bat = { label: 'Bring a Trailer', icon: '🔨', url: `https://bringatrailer.com/search/?${new URLSearchParams({ s: query })}` };
  if (type === 'car') {
    return [
      { label: 'Autotrader', icon: '🚘', url: `https://www.autotrader.com/cars-for-sale/all-cars?${new URLSearchParams({ keywordPhrases: query })}` },
      bat
    ];
  }
  if (type === 'motorcycle') return [bat];
  return []; // off-road and commercial vehicles: no checked marketplace yet
}

module.exports = { saleLinks };
