const helmet = require('helmet');

// AutoDex loads Bootstrap/Popper/jQuery from jsDelivr and code.jquery.com,
// Inter from Google Fonts, and catalog photos from HTTPS hosts.
const directives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", 'https://code.jquery.com', 'https://cdn.jsdelivr.net'],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  imgSrc: ["'self'", 'https:', 'data:'],
  connectSrc: ["'self'"]
};

const motorwagenEmbed = 'https://sketchfab.com/models/47df0cb894a34d33a09361f3cb182070/embed';
module.exports = helmet({ contentSecurityPolicy: { directives } });
module.exports.motorwagenEmbed = motorwagenEmbed;
module.exports.motorwagenFramePolicy = helmet.contentSecurityPolicy({
  directives: { ...directives, frameSrc: [motorwagenEmbed] }
});
