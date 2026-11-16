// Only include documented U.S. model-year cohorts. Display the factory
// production dates from each archive separately from the catalog's model years.
const archive = 'https://www.bmwgroup-classic.com/en/models/bmw-classics/product-description-page.';
const histories = new Map([
  ['528i', {
    generations: [
      {
        code: 'E12', firstYear: 1979, lastYear: 1981, production: '1977–1981',
        url: archive + 'ad-159-1.bmw-528i-e12.html'
      },
      {
        code: 'E39', firstYear: 1997, lastYear: 2000, production: 'September 1995 – August 2000',
        url: archive + 'ad-642-1.bmw-528i-e39.html'
      }
    ]
  }],
  ['840Ci', {
    overview: "The 840Ci was the V8-powered coupé in BMW's first 8 Series generation, the E31.",
    generations: [{
      code: 'E31', firstYear: 1994, lastYear: 1997, production: 'July 1993 – May 1999',
      url: 'https://www.bmwgroup-classic.com/de/modelle/bmw-klassiker/product-description-page.ad-211-1.bmw-840ci-e31.html'
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

const bmw528xiName = {
  text: 'AutoDex follows EPA model names. An early U.S. price sheet for model year 2009 called this E60 sedan the 528xi. The EPA lists it as the 528i xDrive.',
  relatedModel: '528i xDrive',
  sources: [
    { label: 'BMW’s 2009 model-year price sheet', url: 'https://www.bimmerfile.com/wp-content/uploads/2008/09/2009-5-series-pricing1.pdf' },
    { label: 'EPA’s 2009 model listings', url: 'https://www.fueleconomy.gov/Feg/bymodel/2009_BMW_5_Series.shtml' }
  ]
};

const bmw528iXDriveName = {
  text: 'BMW offered this all-wheel-drive 528i in the E60 and F10 generations. In the U.S., the F10 528i gained xDrive for model year 2012.',
  relatedModel: '528xi',
  sources: [
    { label: 'EPA’s 2010 record', url: 'https://www.fueleconomy.gov/feg/noframes/26384.shtml' },
    { label: 'EPA’s 2012 record', url: 'https://www.fueleconomy.gov/feg/noframes/32068.shtml' },
    { label: 'EPA’s 2016 record', url: 'https://www.fueleconomy.gov/feg/noframes/36680.shtml' }
  ]
};

const namingHistories = new Map([['528xi', bmw528xiName], ['528i xDrive', bmw528iXDriveName]]);

function getNamingHistory(make, model) {
  return make === 'BMW' ? namingHistories.get(model) : null;
}

function getGenerationHistory(car) {
  if (car?.make !== 'BMW' || !Array.isArray(car.model_years)) return null;
  const history = histories.get(car.model);
  if (!history) return null;
  const generations = history.generations.filter(({ firstYear, lastYear }) =>
    car.model_years.some(year => Number.isInteger(year) && year >= firstYear && year <= lastYear)
  );
  return generations.length ? { overview: history.overview || null, generations } : null;
}

module.exports = { getGenerationHistory, getNamingHistory };
