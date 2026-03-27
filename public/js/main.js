(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     CURSOR-INTERACTIVE DOT GRID BACKGROUND
  ═══════════════════════════════════════════════════════════════ */

  var canvas = document.createElement('canvas');
  canvas.id = 'bg-canvas';
  // Insert inside .overlay so it renders above page-specific background overlays
  var overlay = document.querySelector('.overlay');
  if (overlay) {
    overlay.prepend(canvas);
  } else {
    document.body.prepend(canvas);
  }
  var ctx = canvas.getContext('2d');

  var SPACING   = 34;     // grid spacing in px
  var BASE_R    = 1;      // base dot radius
  var MAX_R     = 3;      // radius at cursor
  var REACH     = 200;    // cursor influence radius in px
  var BASE_A    = 0.08;   // base dot alpha (subtle grid)
  var MAX_A     = 1.0;    // dot alpha at cursor (full brightness)
  var LERP      = 0.072;  // mouse smoothing (lower = smoother)

  // Accent color components for interpolation
  var AC = { r: 237, g: 83, b: 83 };
  var BC = { r: 200, g: 200, b: 210 }; // base dot color (cool white)

  var mouse  = { x: -9999, y: -9999 };
  var cursor = { x: -9999, y: -9999 }; // smoothed
  var dots   = [];
  var raf;

  function buildDots() {
    dots = [];
    var cols = Math.ceil(canvas.width  / SPACING) + 2;
    var rows = Math.ceil(canvas.height / SPACING) + 2;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        dots.push({ x: c * SPACING, y: r * SPACING });
      }
    }
  }

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    buildDots();
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function draw() {
    // Smooth cursor
    cursor.x = lerp(cursor.x, mouse.x, LERP);
    cursor.y = lerp(cursor.y, mouse.y, LERP);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (var i = 0; i < dots.length; i++) {
      var d  = dots[i];
      var dx = d.x - cursor.x;
      var dy = d.y - cursor.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var prox = Math.max(0, 1 - dist / REACH); // 0–1

      var alpha  = BASE_A + prox * (MAX_A  - BASE_A);
      var radius = BASE_R + prox * (MAX_R  - BASE_R);

      // Color: interpolate base cool-white → accent red near cursor
      var r = Math.round(lerp(BC.r, AC.r, prox));
      var g = Math.round(lerp(BC.g, AC.g, prox));
      var b = Math.round(lerp(BC.b, AC.b, prox));

      // Glow: only pay the shadowBlur cost for dots near cursor
      if (prox > 0.05) {
        ctx.shadowBlur  = prox * 14;
        ctx.shadowColor = 'rgba(' + AC.r + ',' + AC.g + ',' + AC.b + ',' + (prox * 0.9) + ')';
      } else {
        ctx.shadowBlur = 0;
      }

      ctx.beginPath();
      ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
      ctx.fill();
    }

    // Reset shadow so it doesn't bleed
    ctx.shadowBlur = 0;

    raf = requestAnimationFrame(draw);
  }

  // Track real mouse position
  document.addEventListener('mousemove', function (e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    // Also update CSS var for the radial glow overlay
    document.body.style.setProperty('--mx', e.clientX + 'px');
    document.body.style.setProperty('--my', e.clientY + 'px');
  }, { passive: true });

  // When mouse leaves window, fade dots back to base
  document.addEventListener('mouseleave', function () {
    mouse.x = -9999;
    mouse.y = -9999;
  });

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  }, { passive: true });

  resize();
  draw();


  /* ═══════════════════════════════════════════════════════════════
     SCROLL REVEAL
  ═══════════════════════════════════════════════════════════════ */

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.06, rootMargin: '0px 0px -32px 0px' }
  );

  function revealGrid(selector) {
    document.querySelectorAll(selector).forEach(function (row) {
      Array.from(row.children).forEach(function (col, i) {
        if (
          col.classList.contains('col-md-4') ||
          col.classList.contains('col-6')    ||
          col.classList.contains('col-md-3')
        ) {
          col.classList.add('fade-up');
          col.style.setProperty('--delay', i * 0.08 + 's');
          observer.observe(col);
        }
      });
    });
  }

  function revealElements(selector, base) {
    document.querySelectorAll(selector).forEach(function (el, i) {
      el.classList.add('fade-up');
      el.style.setProperty('--delay', (base || 0) + i * 0.1 + 's');
      observer.observe(el);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    revealGrid('.album .row');
    revealGrid('.related-row');
    revealGrid('.garage-grid');
    revealElements('.media-card');
    revealElements('.detail-section');
    revealElements('.auth-wrap');

    // ── Glass card interactions ──────────────────────────────────
    document.querySelectorAll('.card').forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        var rect = card.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        card.style.setProperty('--cx',     x + 'px');
        card.style.setProperty('--cy',     y + 'px');
        // Percentage for the overhead specular position
        card.style.setProperty('--cx-pct', (x / rect.width * 100).toFixed(1) + '%');
      }, { passive: true });
    });
  });


  /* ═══════════════════════════════════════════════════════════════
     NAV: opaque on scroll
  ═══════════════════════════════════════════════════════════════ */

  var masthead = document.querySelector('.masthead');
  if (masthead) {
    window.addEventListener('scroll', function () {
      masthead.classList.toggle('scrolled', window.scrollY > 20);
    }, { passive: true });
  }


  /* ═══════════════════════════════════════════════════════════════
     HERO WORD REVEAL
  ═══════════════════════════════════════════════════════════════ */

  var heading = document.querySelector('.cover-heading');
  if (heading) {
    var words = heading.innerHTML.split(/(\s+|<br\s*\/?>)/gi);
    heading.innerHTML = words.map(function (w, i) {
      if (!w.trim() || /^<br/i.test(w)) return w;
      return '<span class="word-wrap"><span class="word" style="--wi:' + i + '">' + w + '</span></span>';
    }).join('');
  }

})();
