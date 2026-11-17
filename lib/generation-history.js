// Only include documented U.S. model-year cohorts. Display the factory
// production dates from each archive separately from the catalog's model years.
const archive = 'https://www.bmwgroup-classic.com/en/models/bmw-classics/product-description-page.';
const bmwHistories = new Map([
  ['528i', {
    generations: [
      {
        code: 'E12', firstYear: 1979, lastYear: 1981, production: '1977–1981',
        sources: [{ label: 'BMW archive for E12', url: archive + 'ad-159-1.bmw-528i-e12.html' }]
      },
      {
        code: 'E39', firstYear: 1997, lastYear: 2000, production: 'September 1995 – August 2000',
        sources: [{ label: 'BMW archive for E39', url: archive + 'ad-642-1.bmw-528i-e39.html' }]
      }
    ]
  }],
  ['840Ci', {
    overview: "The 840Ci was the V8-powered coupé in BMW's first 8 Series generation, the E31.",
    generations: [{
      code: 'E31', firstYear: 1994, lastYear: 1997, production: 'July 1993 – May 1999',
      sources: [{ label: 'BMW archive for E31', url: 'https://www.bmwgroup-classic.com/de/modelle/bmw-klassiker/product-description-page.ad-211-1.bmw-840ci-e31.html' }]
    }]
  }],
  ['750iL', {
    overview: 'BMW offered the 750iL as a long-wheelbase V12 sedan in both the E32 and E38 generations of the 7 Series.',
    generations: [
      {
        code: 'E32', firstYear: 1988, lastYear: 1994, production: 'May 1987 – July 1994',
        sources: [{ label: 'BMW archive for E32', url: archive + 'ad-208-1.bmw-750il-e32.html' }]
      },
      {
        code: 'E38', firstYear: 1995, lastYear: 2001, production: 'October 1994 – July 2001',
        sources: [{ label: 'BMW archive for E38', url: archive + 'ad-209-1.bmw-750il-e38.html' }]
      }
    ]
  }]
]);

const chevroletHistories = new Map([
  ['Caprice', {
    heading: 'Caprice generations',
    yearLabel: 'U.S. model years',
    generations: [
      {
        firstYear: 1966, lastYear: 1970, title: 'First standalone Caprice',
        description: 'Chevrolet launched Caprice as a separate full-size series for 1966 after offering it as an option on the 1965 Impala Sport Sedan. The 1969 Custom Coupe was part of this generation.',
        sources: [
          { label: '1965 dealer folder', url: 'https://www.oldcarbrochures.org/United%20States/Chevrolet/1965-Chevrolet/1965-Chevrolet-Caprice-Folder/1965_Chevrolet_Caprice_Custom_Sedan-0203.jpg' },
          { label: '1966 Chevrolet brochure', url: 'https://xr793.com/wp-content/uploads/2017/08/1966-Chevrolet-Full-Line.pdf#page=2' },
          { label: '1969 model guide', url: 'https://www.gm.com/content/dam/company/no_search/heritage-archive-docs/vehicle-information-kits/chevrolet/1969-Chevrolet.pdf#page=7' }
        ]
      },
      {
        firstYear: 1971, lastYear: 1976, title: 'Larger full-size redesign',
        description: 'Chevrolet moved the Caprice to a longer full-size chassis for 1971. In 1973, the coupe, sedans, and convertible carried the Caprice Classic name.',
        sources: [
          { label: '1971 Chevrolet brochure', url: 'https://xr793.com/wp-content/uploads/2017/07/1971-Chevrolet-Caprice-Impala-Belair.pdf#page=2' },
          { label: '1973 model guide', url: 'https://www.gm.com/content/dam/company/no_search/heritage-archive-docs/vehicle-information-kits/chevrolet/1973-Chevrolet.pdf#page=5' }
        ]
      },
      {
        firstYear: 1977, lastYear: 1990, title: 'Smaller full-size Caprice',
        description: 'Chevrolet introduced a shorter full-size Caprice Classic for 1977, with coupe, sedan, and wagon body styles.',
        sources: [
          { label: '1977 Chevrolet brochure', url: 'https://xr793.com/wp-content/uploads/2017/07/1977-Chevrolet-Caprice-Classic-Impala.pdf#page=2' },
          { label: '1990 model guide', url: 'https://www.gm.com/content/dam/company/no_search/heritage-archive-docs/vehicle-information-kits/chevrolet/1990-Chevrolet-Caprice.pdf#page=3' }
        ]
      },
      {
        firstYear: 1991, lastYear: 1996, title: 'Rounded body redesign',
        description: 'Chevrolet gave the rear-wheel-drive Caprice a rounder body for 1991. It offered sedans and wagons through the 1996 U.S. model year.',
        sources: [
          { label: '1991 model guide', url: 'https://www.gm.com/content/dam/company/no_search/heritage-archive-docs/vehicle-information-kits/chevrolet/1991-Chevrolet-Caprice.pdf#page=3' },
          { label: '1996 model guide', url: 'https://www.gm.com/content/dam/company/no_search/heritage-archive-docs/vehicle-information-kits/chevrolet/1996-Chevrolet-Caprice.pdf#page=6' }
        ]
      }
    ]
  }]
]);

const historiesByMake = new Map([['BMW', bmwHistories], ['Chevrolet', chevroletHistories]]);

const capricePoliceOverview = {
  summary: 'Chevrolet offered the Caprice Police Patrol Vehicle, a full-size rear-wheel-drive sedan, to U.S. law enforcement for model years 2011–2017.',
  sources: [
    { label: '2011 Chevrolet announcement', url: 'https://www.prnewswire.com/news-releases/chevrolet-prepares-2011-caprice-police-patrol-vehicle-for-duty-99252209.html' },
    { label: '2017 GM fleet specifications (PDF)', url: 'https://www.gmupfitter.com/wp-content/uploads/2021/05/Caprice-9C1-Specification-Guide-2017.pdf' }
  ]
};

function getModelOverview(make, model) {
  return make === 'Chevrolet' && model === 'Caprice Police Vehicle' ? capricePoliceOverview : null;
}

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
  if (!Array.isArray(car?.model_years)) return null;
  const history = historiesByMake.get(car.make)?.get(car.model);
  if (!history) return null;
  const generations = history.generations.filter(({ firstYear, lastYear }) =>
    car.model_years.some(year => Number.isInteger(year) && year >= firstYear && year <= lastYear)
  );
  return generations.length ? {
    heading: history.heading || `${car.make} generation references`,
    yearLabel: history.yearLabel || null,
    overview: history.overview || null,
    generations
  } : null;
}

module.exports = { getGenerationHistory, getNamingHistory, getModelOverview };
