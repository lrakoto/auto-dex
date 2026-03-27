(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     SCROLL PROGRESS BAR
  ═══════════════════════════════════════════════════════════════ */

  var progressBar = document.createElement('div');
  progressBar.id = 'scroll-progress';
  document.body.prepend(progressBar);

  window.addEventListener('scroll', function () {
    var scrolled = window.scrollY;
    var total    = document.documentElement.scrollHeight - window.innerHeight;
    progressBar.style.width = (total > 0 ? (scrolled / total) * 100 : 0) + '%';
  }, { passive: true });


  /* ═══════════════════════════════════════════════════════════════
     PAGE TRANSITIONS
  ═══════════════════════════════════════════════════════════════ */

  // Fade in on load
  document.body.classList.add('page-entering');
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      document.body.classList.remove('page-entering');
    });
  });

  // Fade out on internal link click
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href');
    // Only intercept internal, non-anchor, non-special links
    if (
      !href ||
      href.startsWith('#') ||
      href.startsWith('javascript') ||
      link.target === '_blank' ||
      e.metaKey || e.ctrlKey || e.shiftKey
    ) return;
    if (href.startsWith('http') && !href.includes(location.hostname)) return;

    e.preventDefault();
    document.body.classList.add('page-exit');
    setTimeout(function () { location.href = href; }, 230);
  });


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

  // Accent color — white on homepage, red everywhere else
  var isHome = !!document.querySelector('.home-overlay');
  var AC = isHome ? { r: 255, g: 255, b: 255 } : { r: 237, g: 83, b: 83 };
  var BC = { r: 200, g: 200, b: 210 }; // base dot color (cool white)

  var mouse  = { x: -9999, y: -9999 };
  var cursor = { x: -9999, y: -9999 }; // smoothed
  var dots   = [];
  var raf;

  /* ── Angled sweep wave ─────────────────────────────────────── */
  var WAVE_ANGLE_TAN  = Math.tan(14 * Math.PI / 180); // ~0.249
  var WAVE_HALF_WIDTH = 220;  // px — Gaussian sigma for the wave band
  var WAVE_STRENGTH   = 0.20; // peak boost added to prox
  var WAVE_SPEED      = 0.00038; // progress units per ms
  var WAVE_INTERVAL   = 5500;  // ms between spawns

  var sweepWaves   = [];
  var lastWaveTime = -WAVE_INTERVAL; // spawn first wave quickly

  function spawnWave(now) {
    sweepWaves.push({ startTime: now, progress: 0 });
    lastWaveTime = now;
  }

  /* ── Page-load shockwave (radial) ──────────────────────────── */
  var SHOCK_RADIUS_MAX  = 1800; // px — how far the ring expands
  var SHOCK_HALF_RING   = 80;   // px — Gaussian sigma for ring thickness
  var SHOCK_STRENGTH    = 0.85;
  var SHOCK_DURATION    = 2200; // ms
  var shockwave         = null; // { startTime }


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

  function gaussianFalloff(dist, sigma) {
    return Math.exp(-0.5 * (dist / sigma) * (dist / sigma));
  }

  function draw(now) {
    // Smooth cursor
    cursor.x = lerp(cursor.x, mouse.x, LERP);
    cursor.y = lerp(cursor.y, mouse.y, LERP);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ── Advance / cull sweep waves ──────────────────────────────
    var w = canvas.width;
    var h = canvas.height;
    // The effective-x range spans from leftmost dot (0 + 0*tan) to rightmost dot (w + h*tan)
    var sweepMin = -(WAVE_HALF_WIDTH * 3);
    var sweepMax = w + h * WAVE_ANGLE_TAN + (WAVE_HALF_WIDTH * 3);

    sweepWaves = sweepWaves.filter(function (wv) {
      wv.progress = (now - wv.startTime) * WAVE_SPEED;
      var frontX = sweepMin + wv.progress * (sweepMax - sweepMin);
      return frontX < sweepMax + WAVE_HALF_WIDTH * 3;
    });

    // Spawn new wave at interval
    if (now - lastWaveTime >= WAVE_INTERVAL) {
      spawnWave(now);
    }

    // ── Shockwave ───────────────────────────────────────────────
    var shockBoostOriginX = 0;
    var shockBoostOriginY = 0;
    var shockActive = false;
    var shockElapsed = 0;
    if (shockwave) {
      shockElapsed = now - shockwave.startTime;
      if (shockElapsed < SHOCK_DURATION) {
        shockActive = true;
        shockBoostOriginX = shockwave.originX;
        shockBoostOriginY = shockwave.originY;
      } else {
        shockwave = null;
      }
    }

    // ── Draw dots ───────────────────────────────────────────────
    for (var i = 0; i < dots.length; i++) {
      var d  = dots[i];
      var dx = d.x - cursor.x;
      var dy = d.y - cursor.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var prox = Math.max(0, 1 - dist / REACH); // 0–1 cursor influence

      // Sweep wave boost
      var waveBoost = 0;
      var dotEffX = d.x + d.y * WAVE_ANGLE_TAN;
      for (var wi = 0; wi < sweepWaves.length; wi++) {
        var wv = sweepWaves[wi];
        var frontX = sweepMin + wv.progress * (sweepMax - sweepMin);
        var waveDist = dotEffX - frontX;
        waveBoost = Math.max(waveBoost, WAVE_STRENGTH * gaussianFalloff(waveDist, WAVE_HALF_WIDTH));
      }

      // Shockwave boost
      var shockBoost = 0;
      if (shockActive) {
        var shockRadius = (shockElapsed / SHOCK_DURATION) * SHOCK_RADIUS_MAX;
        var sdx = d.x - shockBoostOriginX;
        var sdy = d.y - shockBoostOriginY;
        var sDist = Math.sqrt(sdx * sdx + sdy * sdy);
        shockBoost = SHOCK_STRENGTH * gaussianFalloff(sDist - shockRadius, SHOCK_HALF_RING);
      }

      // Combine: cursor prox + wave + shock, clamped to 1
      var combined = Math.min(1, prox + waveBoost * (1 - prox) + shockBoost * (1 - Math.max(prox, waveBoost)));

      var alpha  = BASE_A + combined * (MAX_A  - BASE_A);
      var radius = BASE_R + combined * (MAX_R  - BASE_R);

      // Color: interpolate base cool-white → accent red near cursor/wave
      var r = Math.round(lerp(BC.r, AC.r, combined));
      var g = Math.round(lerp(BC.g, AC.g, combined));
      var b = Math.round(lerp(BC.b, AC.b, combined));

      // Glow: only pay the shadowBlur cost for dots near cursor
      if (combined > 0.05) {
        ctx.shadowBlur  = combined * 14;
        ctx.shadowColor = 'rgba(' + AC.r + ',' + AC.g + ',' + AC.b + ',' + (combined * 0.9) + ')';
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
  requestAnimationFrame(function (now) {
    lastWaveTime = now; // start the interval clock from first frame
    draw(now);
  });


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
    var MAX_TILT = 2.0; // degrees — very subtle
    document.querySelectorAll('.card').forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        var rect = card.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        card.style.setProperty('--cx',     x + 'px');
        card.style.setProperty('--cy',     y + 'px');
        card.style.setProperty('--cx-pct', (x / rect.width * 100).toFixed(1) + '%');
        // Tilt: cursor offset from card centre, normalised to -1..1
        var tiltY = ((x - rect.width  / 2) / (rect.width  / 2) * MAX_TILT).toFixed(2);
        var tiltX = ((y - rect.height / 2) / (rect.height / 2) * MAX_TILT).toFixed(2);
        card.style.setProperty('--tilt-x', (-tiltX) + 'deg');
        card.style.setProperty('--tilt-y',   tiltY  + 'deg');
      }, { passive: true });

      card.addEventListener('mouseleave', function () {
        card.style.setProperty('--tilt-x', '0deg');
        card.style.setProperty('--tilt-y', '0deg');
      }, { passive: true });
    });

    // ── Recently Viewed ──────────────────────────────────────────
    var rvWrap = document.getElementById('recently-viewed');
    if (rvWrap) {
      try {
        var recent = JSON.parse(localStorage.getItem('autodex_recent') || '[]');
        if (recent.length > 0) {
          var row = rvWrap.querySelector('.recently-viewed-row');
          recent.forEach(function(c) {
            var col = document.createElement('div');
            col.className = 'col-md-2 col-4 mb-3 card-col';
            col.innerHTML = '<div class="card h-100">' +
              '<a href="' + c.url + '"><img class="card-img-top imgresp" src="' + c.image + '" alt="' + c.model + '" style="height:90px;"></a>' +
              '<div class="card-body" style="padding:0.5rem;">' +
              '<p class="card-text mb-0" style="font-size:0.72rem;"><a href="' + c.url + '" class="text-dark">' + c.model + '</a></p>' +
              '</div></div>';
            row.appendChild(col);
          });
          rvWrap.style.display = 'block';
        }
      } catch(e) {}
    }

    // ── Toast ────────────────────────────────────────────────────
    function showToast(msg) {
      var t = document.createElement('div');
      t.className = 'toast-notification';
      t.textContent = msg;
      document.body.appendChild(t);
      requestAnimationFrame(function() { t.classList.add('toast-show'); });
      setTimeout(function() {
        t.classList.remove('toast-show');
        setTimeout(function() { t.remove(); }, 300);
      }, 2600);
    }

    // ── Favorite form AJAX intercept ─────────────────────────────
    document.addEventListener('submit', function(e) {
      var form = e.target;
      if (!form.action || !form.action.includes('/fav')) return;
      e.preventDefault();
      var params = new URLSearchParams(new FormData(form));
      fetch(form.action, {
        method: 'POST',
        body: params,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest'
        }
      }).then(function(r) { return r.json(); })
        .then(function() { showToast('Added to favorites ♥'); })
        .catch(function() { showToast('Could not add — try again.'); });
    });

    // ── Search form loading state ─────────────────────────────────
    var heroForm = document.querySelector('.hero-form');
    if (heroForm) {
      heroForm.addEventListener('submit', function() {
        var btn = heroForm.querySelector('button[type="submit"]');
        if (btn) { btn.textContent = 'Searching…'; btn.disabled = true; }
      });
    }

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
