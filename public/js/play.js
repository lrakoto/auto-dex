// "Who's That Car?" — answers without a page load, reveals the car, and swaps
// in the next round (already fetched with the answer, photo preloaded).
// Without JS the form posts and the server redirects back; same game.
(function () {
  'use strict';

  var card = document.getElementById('play-card');
  var form = document.getElementById('play-form');
  if (!card || !form || !window.fetch) return;

  var img = document.getElementById('play-img');
  var credit = document.getElementById('play-credit');
  var streakEl = document.getElementById('play-streak');
  var bestEl = document.getElementById('play-best');
  var result = document.getElementById('play-result');
  var verdict = document.getElementById('play-verdict');
  var answerLink = document.getElementById('play-answer-link');
  var answerMeta = document.getElementById('play-answer-meta');
  var fixLink = document.getElementById('play-fix-link');
  var nextBtn = document.getElementById('play-next');
  var csrf = form.querySelector('input[name="_csrf"]').value;
  var typeInput = form.querySelector('input[name="type"]');
  var quizType = typeInput ? typeInput.value : 'car';

  var next = null;  // the round that comes with each answer
  var busy = false;

  var CHEERS = ['Nailed it.', 'Correct!', 'You know your stuff.', 'Spot on.', 'Easy money.'];

  function choices() {
    return Array.prototype.slice.call(form.querySelectorAll('.play-choice'));
  }

  function bump(el, value) {
    el.textContent = value;
    el.classList.remove('bump');
    void el.offsetWidth; // restart the animation
    el.classList.add('bump');
  }

  // Credit line from { name, url, unsplash } — built as DOM, never as HTML
  function renderCredit(c) {
    credit.textContent = '';
    if (!c || (!c.name && !c.unsplash)) return;
    function link(text, href) {
      var a = document.createElement('a');
      a.textContent = text;
      if (/^https:\/\//.test(href || '')) a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      return a;
    }
    var unsplash = 'https://unsplash.com/?utm_source=autodex&utm_medium=referral';
    if (c.name) {
      credit.appendChild(document.createTextNode('Photo: '));
      credit.appendChild(c.url ? link(c.name, c.url) : document.createTextNode(c.name));
      if (c.unsplash) {
        credit.appendChild(document.createTextNode(' on '));
        credit.appendChild(link('Unsplash', unsplash));
      }
    } else {
      credit.appendChild(document.createTextNode('Photo from '));
      credit.appendChild(link('Unsplash', unsplash));
    }
  }

  function reveal(data) {
    choices().forEach(function (b) {
      var id = parseInt(b.value, 10);
      if (id === data.answerId) b.classList.add('is-correct');
      else if (id === data.choice) b.classList.add('is-wrong');
      else b.classList.add('is-out');
    });
    card.dataset.state = 'answered';
    card.classList.toggle('was-correct', data.correct);
    card.classList.toggle('was-wrong', !data.correct);

    verdict.textContent = data.correct ? CHEERS[Math.floor(Math.random() * CHEERS.length)] : 'Not quite.';
    answerLink.textContent = (data.make || '') + ' ' + (data.model || '');
    if (data.url) {
      answerLink.href = data.url;
      fixLink.href = data.url + '#gallery';
    }
    fixLink.hidden = !data.url;
    answerMeta.textContent = [data.years, data.country].filter(Boolean).join(' · ');
    result.hidden = false;

    bump(streakEl, data.streak);
    if (String(data.best) !== bestEl.textContent) bump(bestEl, data.best);

    next = data.next;
    if (next && next.image) new Image().src = next.image; // preload
    nextBtn.focus({ preventScroll: true });
  }

  function guess(btn) {
    if (busy || card.dataset.state !== 'question') return;
    busy = true;
    choices().forEach(function (b) { b.disabled = true; });
    btn.classList.add('is-picked');
    fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams({ _csrf: csrf, choice: btn.value, type: quizType })
    })
      .then(function (r) {
        // 409: this tab's round is over (answered elsewhere, session expired)
        if (r.status === 409) { window.location.reload(); return null; }
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        if (!data.success) throw new Error('guess failed');
        reveal(data);
      })
      .catch(function () {
        choices().forEach(function (b) { b.disabled = false; b.classList.remove('is-picked'); });
        verdict.textContent = "Couldn't reach AutoDex — try again.";
        result.hidden = false;
      })
      .then(function () { busy = false; });
  }

  function showNext() {
    if (card.dataset.state !== 'answered') return;
    if (!next) { window.location.reload(); return; }
    img.classList.add('is-swapping');
    img.src = next.image;
    renderCredit(next.credit);

    var buttons = choices();
    next.choices.forEach(function (c, i) {
      var b = buttons[i];
      if (!b) return;
      b.value = c.id;
      b.querySelector('.play-label').textContent = c.label;
      b.className = 'play-choice';
      b.disabled = false;
    });
    result.hidden = true;
    card.classList.remove('was-correct', 'was-wrong');
    card.dataset.state = 'question';
    next = null;
    var lead = document.querySelector('.play-last');
    if (lead) lead.remove();
    (buttons[0] || nextBtn).focus({ preventScroll: true });
  }

  img.addEventListener('load', function () { img.classList.remove('is-swapping'); });
  img.addEventListener('error', function () {
    img.classList.remove('is-swapping');
    credit.textContent = "This photo didn't load. Skip it below.";
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = e.submitter || document.activeElement;
    if (btn && btn.classList && btn.classList.contains('play-choice')) guess(btn);
  });
  nextBtn.addEventListener('click', showNext);

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (card.dataset.state === 'question' && /^[1-4]$/.test(e.key)) {
      var btn = choices()[parseInt(e.key, 10) - 1];
      if (btn) { e.preventDefault(); guess(btn); }
    } else if (card.dataset.state === 'answered' && (e.key === 'Enter' || e.key === 'n' || e.key === 'N')) {
      // Enter on a focused link/button does its own thing
      if (e.key === 'Enter' && t && (t.tagName === 'A' || (t.tagName === 'BUTTON' && t !== nextBtn))) return;
      e.preventDefault();
      showNext();
    }
  });
})();
