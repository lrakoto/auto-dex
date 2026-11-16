// A series article can show a different trim. Give each verified replacement
// its own credit, and keep the known mismatched file out of that trim's gallery.
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

const bmw528iFile = '2000_BMW_528i_Sedan_in_Jet_Black,_Front_Left,_07-12-2023.jpg';
const bmw750ilCredit = 'https://commons.wikimedia.org/wiki/File:BMW_750iL.jpg';
const verifiedPhotoCorrections = [
  {
    make: 'BMW',
    model: '528i',
    wrongFile: commonsFilePattern('9/93', 'BMW_550i_(F10)_–_Frontansicht_(2),_17._Juli_2011,_Mettmann.jpg'),
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
    model: '750iL',
    wrongFile: commonsFilePattern('c/c1', 'BMW_730i_(E32)_registered_August_1990_2986cc.jpg'),
    photo: {
      url: thumbUrl({ hash: 'c/cc', file: 'BMW_750iL.jpg' }, HERO_WIDTH),
      creditName: 'TTTNIS',
      creditUrl: bmw750ilCredit,
      license: 'Public domain',
      licenseUrl: bmw750ilCredit + '#Licensing'
    }
  }
];

function photoCorrectionFor(car) {
  return verifiedPhotoCorrections.find(({ make, model }) => car?.make === make && car?.model === model);
}

function isMismatchedCatalogPhoto(car, url) {
  return Boolean(url && photoCorrectionFor(car)?.wrongFile.test(url));
}

module.exports = { verifiedPhotoCorrections, photoCorrectionFor, isMismatchedCatalogPhoto };
