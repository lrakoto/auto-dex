// Keep verified Commons photos and their credits with the exact catalog trim.
// Entries without a known mismatch fill empty covers and replace retired photos.
const { thumbUrl, HERO_WIDTH } = require('./wikimedia');

function commonsFilePattern(hash, name) {
  // Stored Commons URLs can contain literal or percent-encoded punctuation.
  // Match the source filename before the thumbnail size, query or fragment.
  const file = name.replace(/[().,–]/g, char => {
    const encoded = Buffer.from(char).toString('hex').replace(/../g, '%$&');
    return `([${char}]|${encoded})`;
  });
  return new RegExp(`^\\s*(https?:)?//(upload|thumb)[.]wikimedia[.]org/wikipedia/commons/(thumb/)?${hash}/${file}([/?#]|$)`, 'i');
}

const bmw550iPhoto = commonsFilePattern('9/93', 'BMW_550i_(F10)_–_Frontansicht_(2),_17._Juli_2011,_Mettmann.jpg');
const bmw528iFile = '2000_BMW_528i_Sedan_in_Jet_Black,_Front_Left,_07-12-2023.jpg';
const bmw528xiCredit = 'https://commons.wikimedia.org/wiki/File:BMW_528xi_sedan.jpg';
const bmw750ilCredit = 'https://commons.wikimedia.org/wiki/File:BMW_750iL.jpg';
const bmw850csiFile = '1995_BMW_850_CSi.JPG';
const bmw850csiCredit = 'https://commons.wikimedia.org/wiki/File:' + bmw850csiFile;
const fordAspireFile = 'Ford_Aspire_front_--_07-22-2010.jpg';
const fordAspireCredit = 'https://commons.wikimedia.org/wiki/File:' + fordAspireFile;
const ram2500File = '%2720_Ram_2500_Cummins_Crew_Cab.jpg';
const ram2500Credit = 'https://commons.wikimedia.org/wiki/File:' + ram2500File;
const scg004sFile = '2021_Scuderia_Cameron_Glickenhaus_SCG_004S_in_GOLD%2C_front_left.jpg';
const verifiedCatalogPhotos = [
  {
    make: 'BMW',
    model: '1M',
    photo: {
      url: thumbUrl({ hash: 'd/d3', file: 'BMW_1_Series_M_Coupe_%28front_quarter%29.jpg' }, HERO_WIDTH),
      creditName: 'Overlaet',
      creditUrl: 'https://commons.wikimedia.org/wiki/File:BMW_1_Series_M_Coupe_(front_quarter).jpg',
      license: 'CC BY-SA 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/'
    }
  },
  {
    make: 'BMW',
    model: '528i',
    wrongFile: bmw550iPhoto,
    photo: {
      url: thumbUrl({ hash: 'f/ff', file: encodeURIComponent(bmw528iFile) }, HERO_WIDTH),
      creditName: 'Elise240SX',
      creditUrl: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(bmw528iFile),
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'
    }
  },
  {
    make: 'BMW',
    model: '528xi',
    wrongFile: bmw550iPhoto,
    photo: {
      url: thumbUrl({ hash: 'a/a6', file: 'BMW_528xi_sedan.jpg' }, HERO_WIDTH),
      creditName: 'IFCAR',
      creditUrl: bmw528xiCredit,
      license: 'Public domain',
      licenseUrl: bmw528xiCredit + '#Licensing'
    }
  },
  {
    make: 'BMW',
    model: '528i xDrive',
    photo: {
      url: thumbUrl({ hash: '8/8d', file: '2016_BMW_528i_xDrive.jpg' }, HERO_WIDTH),
      creditName: 'DestinationFearFan',
      creditUrl: 'https://commons.wikimedia.org/wiki/File:2016_BMW_528i_xDrive.jpg',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'
    }
  },
  {
    make: 'BMW',
    model: '750iL',
    wrongFile: commonsFilePattern('c/c1', 'BMW_730i_(E32)_registered_August_1990_2986cc.jpg'),
    photo: {
      url: thumbUrl({ hash: 'c/cc', file: 'BMW_750iL.jpg' }, HERO_WIDTH),
      creditName: 'TTTNIS',
      creditUrl: bmw750ilCredit,
      license: 'Public domain',
      licenseUrl: bmw750ilCredit + '#Licensing'
    }
  },
  {
    make: 'BMW',
    model: '850CSi',
    wrongFile: commonsFilePattern('e/ec', 'BMW_840_Ci_(7724204324)_(cropped).jpg'),
    photo: {
      url: thumbUrl({ hash: '4/40', file: bmw850csiFile }, HERO_WIDTH),
      creditName: 'Jagvar',
      creditUrl: bmw850csiCredit,
      license: 'Public domain',
      licenseUrl: bmw850csiCredit + '#Licensing'
    }
  },
  {
    make: 'Chevrolet',
    model: 'Caprice',
    wrongFile: commonsFilePattern('0/00', '2011_Chevrolet_Caprice_PPV_--_12-06-2010_front.jpg'),
    photo: {
      url: thumbUrl({ hash: '9/90', file: '1969_Chevrolet_Caprice_%284847268053%29.jpg' }, HERO_WIDTH),
      creditName: 'dave_7',
      creditUrl: 'https://commons.wikimedia.org/wiki/File:1969_Chevrolet_Caprice_%284847268053%29.jpg',
      license: 'CC BY 2.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.0/'
    }
  },
  {
    make: 'Ford',
    model: 'Aspire',
    photo: {
      url: thumbUrl({ hash: '7/79', file: fordAspireFile }, HERO_WIDTH),
      creditName: 'IFCAR',
      creditUrl: fordAspireCredit,
      license: 'Public domain',
      licenseUrl: fordAspireCredit + '#Licensing'
    }
  },
  {
    make: 'Ram',
    model: '2500',
    photo: {
      url: thumbUrl({ hash: 'e/e8', file: ram2500File }, HERO_WIDTH),
      creditName: 'Bull-Doser',
      creditUrl: ram2500Credit,
      license: 'Public domain',
      licenseUrl: ram2500Credit + '#Licensing'
    }
  },
  {
    make: 'Scuderia Cameron Glickenhaus (SCG)',
    model: '004S',
    photo: {
      url: thumbUrl({ hash: 'b/b1', file: scg004sFile }, HERO_WIDTH),
      creditName: 'Mr.choppers',
      creditUrl: 'https://commons.wikimedia.org/wiki/File:' + scg004sFile,
      license: 'CC BY-SA 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/'
    }
  }
];

function verifiedPhotoFor(car) {
  return verifiedCatalogPhotos.find(({ make, model }) => car?.make === make && car?.model === model);
}

function isMismatchedCatalogPhoto(car, url) {
  return Boolean(url && verifiedPhotoFor(car)?.wrongFile?.test(url));
}

module.exports = { verifiedCatalogPhotos, verifiedPhotoFor, isMismatchedCatalogPhoto };
