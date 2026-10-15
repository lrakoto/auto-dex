const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const { photoCredit } = require('../lib/photos');

describe('licensed replacement photo attribution', function() {
  const row = {
    source: 'openverse', credit_name: 'Jane <Artist>', credit_url: 'https://example.test/source?model=Civic&year=2020',
    license: 'CC BY 4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/'
  };
  const render = credit => ejs.renderFile(path.join(__dirname, '../views/partials/photo-credit.ejs'), { credit });

  it('renders the original source, escaped creator and license link for Openverse', async function() {
    const html = await render(photoCredit('https://example.test/civic.jpg', row));
    assert.ok(html.includes('Jane &lt;Artist&gt;'));
    assert.ok(html.includes('https://example.test/source?model=Civic&amp;year=2020'));
    assert.ok(html.includes('href="https://creativecommons.org/licenses/by/4.0/"'));
    assert.ok(html.includes('CC BY 4.0'));
    assert.ok(!html.includes('Unsplash'));
  });

  it('retains attribution without disclosing the model-bearing source in a quiz', async function() {
    const html = await render(photoCredit('https://example.test/civic.jpg', row, { linkSource: false }));
    assert.ok(html.includes('Jane &lt;Artist&gt;'));
    assert.ok(html.includes('CC BY 4.0'));
    assert.ok(!html.includes('example.test/source'));
  });
});
