// Only include documented U.S. model-year cohorts. Display the factory
// production dates from each archive separately from the catalog's model years.
const archive = 'https://www.bmwgroup-classic.com/en/models/bmw-classics/product-description-page.';
const histories = new Map([
  ['528i', {
    generations: [{
      code: 'E39', firstYear: 1997, lastYear: 2000, production: 'September 1995 – August 2000',
      url: archive + 'ad-642-1.bmw-528i-e39.html'
    }]
  }],
  ['750iL', {
    overview: 'BMW offered the 750iL as a long-wheelbase V12 sedan in both the E32 and E38 generations of the 7 Series.',
    generations: [
      {
        code: 'E32', firstYear: 1988, lastYear: 1994, production: 'May 1987 – July 1994',
        url: archive + 'ad-208-1.bmw-750il-e32.html'
      },
      {
        code: 'E38', firstYear: 1995, lastYear: 2001, production: 'October 1994 – July 2001',
        url: archive + 'ad-209-1.bmw-750il-e38.html'
      }
    ]
  }]
]);

function getGenerationHistory(car) {
  if (car?.make !== 'BMW' || !Array.isArray(car.model_years)) return null;
  const history = histories.get(car.model);
  if (!history) return null;
  const generations = history.generations.filter(({ firstYear, lastYear }) =>
    car.model_years.some(year => Number.isInteger(year) && year >= firstYear && year <= lastYear)
  );
  return generations.length ? { overview: history.overview || null, generations } : null;
}

module.exports = { getGenerationHistory };
