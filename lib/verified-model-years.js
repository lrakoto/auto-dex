const VERIFIED_MODEL_YEARS = [
  // vPIC lists pre-launch years and omits 1997. The EPA has all four years.
  { make: 'BMW', model: '840Ci', years: [1994, 1995, 1996, 1997] },
  {
    // The EPA's original guides cover the two years before our vPIC scan.
    // The later EPA dataset lists the exact 528i separately from AWD models.
    make: 'BMW', model: '528i',
    years: [1979, 1980, 1981, 1997, 1998, 1999, 2000, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016]
  },
  // EPA lists 528xi for 2008. BMW and EPA used 528i xDrive for the later sedan.
  { make: 'BMW', model: '528xi', years: [2008] },
  {
    // vPIC does not list this name. EPA records the E60 and F10 runs separately.
    make: 'BMW', model: '528i xDrive', supplemental: true, photoRequiresExactName: true,
    years: [2009, 2010, 2012, 2013, 2014, 2015, 2016]
  },
  {
    // Ford launched the 1965 Mustang in 1964. Ford's Mustang II covers
    // 1974–1978, and EPA lists Mustang again for 1979 and 1980.
    make: 'Ford', model: 'Mustang', addToScannedYears: true,
    years: [1965, 1966, 1967, 1968, 1969, 1970, 1971, 1972, 1973, 1979, 1980]
  },
  {
    // Ford marketed the second-generation production car as Mustang II.
    make: 'Ford', model: 'Mustang II', supplemental: true, photoRequiresExactName: true,
    years: [1974, 1975, 1976, 1977, 1978]
  }
];

function verifiedModelFor(make, model) {
  return VERIFIED_MODEL_YEARS.find(entry => entry.make === make && entry.model === model);
}

function yearFields(years) {
  return { model_years: years, year_min: years[0], year_max: years[years.length - 1] };
}

module.exports = { VERIFIED_MODEL_YEARS, verifiedModelFor, yearFields };
