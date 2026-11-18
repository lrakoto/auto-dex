const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../server');

const embed = 'https://sketchfab.com/models/47df0cb894a34d33a09361f3cb182070/embed';

describe('Public Motorwagen exhibit', function() {
  it('shows the attributed poster and limits the opt-in embed to the exhibit', async function() {
    const exhibit = await request(app).get('/cars/motorwagen-3d').expect(200);
    const policy = exhibit.headers['content-security-policy'];
    assert.ok(policy.split(';').includes(`frame-src ${embed}`));
    assert.match(policy, /connect-src 'self'/);
    assert.ok(exhibit.text.includes(`data-embed="${embed}"`));
    assert.match(exhibit.text, /id="motorwagen-poster"/);
    assert.match(exhibit.text, /Photo by Deutsches Museum, Munich/);
    assert.match(exhibit.text, /creativecommons\.org\/licenses\/by-sa\/4\.0/);
    assert.doesNotMatch(exhibit.text, /<iframe\b/);
    const explore = await request(app).get('/cars/explore').expect(200);
    assert.match(explore.text, /href="\/cars\/motorwagen-3d"/);
    assert.doesNotMatch(explore.headers['content-security-policy'], /sketchfab\.com/);
  });
});
