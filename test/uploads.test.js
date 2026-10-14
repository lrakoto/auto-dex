const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const express = require('express');
const request = require('supertest');
const { MulterError } = require('multer');
const { upload, cloudinary } = require('../config/cloudinary');

// Exercise the production parser and Cloudinary adapter without sending files
// to an external service. Auth/CSRF route behavior is covered by the app suite.
describe('Configured image uploads', function() {
  const app = express();
  app.post('/upload', upload.single('carImage'), (req, res) => {
    res.json({ fields: req.body, file: req.file ? {
      path: req.file.path, size: req.file.size, filename: req.file.filename
    } : null });
  });
  app.use((err, req, res, next) => {
    res.status(err instanceof MulterError ? 400 : 500).json({ code: err.code });
  });

  let realUpload, realDestroy, uploads, removed;
  beforeEach(function() {
    realUpload = cloudinary.uploader.upload_stream;
    realDestroy = cloudinary.uploader.destroy;
    uploads = 0;
    removed = [];
    cloudinary.uploader.upload_stream = (options, callback) => {
      uploads++;
      assert.equal(options.folder, 'autodex');
      let bytes = 0;
      return new Writable({
        write(chunk, encoding, done) { bytes += chunk.length; done(); },
        final(done) {
          callback(null, { secure_url: 'https://example.test/car.jpg', public_id: 'autodex/test-car', bytes });
          done();
        }
      });
    };
    cloudinary.uploader.destroy = (filename, options, callback) => {
      removed.push(filename);
      callback(null, { result: 'ok' });
    };
  });
  afterEach(function() {
    cloudinary.uploader.upload_stream = realUpload;
    cloudinary.uploader.destroy = realDestroy;
  });

  it('rejects crafted sparse-array fields without crashing or blocking later requests', async function() {
    const res = await request(app).post('/upload')
      .field('items[4294967294]', 'x').field('items[]', 'y')
      .timeout({ response: 2000, deadline: 3000 }).expect(400);
    assert.equal(res.body.code, 'LIMIT_FIELD_NESTING');
    assert.equal(uploads, 0);
    const valid = await request(app).post('/upload').field('make', 'Toyota').expect(200);
    assert.equal(valid.body.fields.make, 'Toyota');
  });

  it('rejects nested field paths before constructing objects', async function() {
    const res = await request(app).post('/upload').field('notes[nested][value]', 'x').expect(400);
    assert.equal(res.body.code, 'LIMIT_FIELD_NESTING');
    assert.equal(uploads, 0);
  });

  it('preserves the flat fields used by garage forms', async function() {
    const fields = { make: 'Honda', model: 'Civic', year: '2020', notes: 'Daily driver', _csrf: 'test-form-token' };
    let post = request(app).post('/upload');
    for (const [name, value] of Object.entries(fields)) post = post.field(name, value);
    const res = await post.expect(200);
    assert.deepEqual(res.body.fields, fields);
    assert.equal(res.body.file, null);
    assert.equal(uploads, 0);
  });

  it('streams an accepted image through the existing Cloudinary adapter', async function() {
    const image = Buffer.from('test image bytes');
    const res = await request(app).post('/upload')
      .field('make', 'Honda')
      .attach('carImage', image, { filename: 'car.jpg', contentType: 'image/jpeg' }).expect(200);
    assert.deepEqual(res.body.file, { path: 'https://example.test/car.jpg', size: image.length, filename: 'autodex/test-car' });
    assert.equal(res.body.fields.make, 'Honda');
    assert.equal(uploads, 1);
    assert.deepEqual(removed, []);
  });

  it('rejects images above 5 MB and cleans up the partial upload', async function() {
    const res = await request(app).post('/upload')
      .attach('carImage', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'large.jpg', contentType: 'image/jpeg' })
      .expect(400);
    assert.equal(res.body.code, 'LIMIT_FILE_SIZE');
    assert.deepEqual(removed, ['autodex/test-car']);
  });

  it('skips non-image files before invoking storage', async function() {
    const res = await request(app).post('/upload')
      .attach('carImage', Buffer.from('plain text'), { filename: 'notes.txt', contentType: 'text/plain' }).expect(200);
    assert.equal(res.body.file, null);
    assert.equal(uploads, 0);
  });
});
