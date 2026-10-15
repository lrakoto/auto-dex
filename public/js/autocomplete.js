(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function init() {
    document.querySelectorAll('.search-input-wrap').forEach(function (wrap, n) {
      var input = wrap.querySelector('input[name="q"]');
      var dropdown = wrap.querySelector('.suggest-dropdown');
      if (!input || !dropdown) return;

      var debounce;
      var generation = 0;
      var active = -1;
      var renderedQuery = '';
      var listId = 'suggest-list-' + n;
      dropdown.id = listId;
      dropdown.setAttribute('role', 'listbox');
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-controls', listId);
      input.setAttribute('aria-expanded', 'false');

      function query() { return input.value.trim(); }
      function items() { return dropdown.querySelectorAll('.suggest-item'); }
      function highlight(index) {
        var list = items();
        active = index;
        list.forEach(function (item, i) {
          item.classList.toggle('active', i === index);
          item.setAttribute('aria-selected', String(i === index));
        });
        if (index >= 0 && list[index]) {
          input.setAttribute('aria-activedescendant', list[index].id);
          list[index].scrollIntoView({ block: 'nearest' });
        } else {
          input.removeAttribute('aria-activedescendant');
        }
      }
      function hide() {
        dropdown.style.display = 'none';
        input.setAttribute('aria-expanded', 'false');
        highlight(-1);
      }
      function invalidate(clearOptions) {
        generation++;
        clearTimeout(debounce);
        hide();
        if (clearOptions) {
          dropdown.innerHTML = '';
          renderedQuery = '';
        }
      }
      function current(id, q) {
        return id === generation && query() === q && document.activeElement === input;
      }
      function show() {
        if (document.activeElement !== input || query().length < 2 ||
            renderedQuery !== query() || !items().length) return;
        dropdown.style.display = 'block';
        input.setAttribute('aria-expanded', 'true');
      }
      function isOpen() {
        return dropdown.style.display === 'block' && renderedQuery === query() &&
          document.activeElement === input;
      }

      input.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          // A dismissal also cancels responses that have not opened a menu yet.
          invalidate(false);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (!isOpen()) show();
          var count = items().length;
          if (!isOpen() || !count) return;
          event.preventDefault();
          var step = event.key === 'ArrowDown' ? 1 : -1;
          highlight(active < 0 ? (step > 0 ? 0 : count - 1) : (active + step + count) % count);
        } else if (event.key === 'Enter' && isOpen() && active >= 0) {
          event.preventDefault();
          window.location.href = items()[active].href;
        }
      });

      dropdown.addEventListener('mouseover', function (event) {
        var item = event.target.closest('.suggest-item');
        if (isOpen() && item) highlight(Array.prototype.indexOf.call(items(), item));
      });

      function requestSuggestions() {
        // Invalidate on every edit, including a clear or a return to an old query.
        invalidate(true);
        var q = query();
        if (q.length < 2 || document.activeElement !== input) return;
        var id = generation;
        debounce = setTimeout(function () {
          if (!current(id, q)) return;
          fetch('/suggest?q=' + encodeURIComponent(q))
            .then(function (response) {
              if (!response.ok) throw new Error('Suggestions unavailable');
              return response.json();
            })
            .then(function (data) {
              if (!current(id, q)) return;
              if (!data || !Array.isArray(data.makes) || !Array.isArray(data.models)) {
                throw new Error('Invalid suggestions');
              }
              var makes = data.makes.filter(function (make) { return typeof make === 'string' && make.trim(); });
              var models = data.models.filter(function (car) {
                return car && typeof car.make === 'string' && typeof car.model === 'string' && car.make.trim() && car.model.trim();
              });
              var html = '';
              var k = 0;
              function option(href, inner) {
                return '<a class="suggest-item" role="option" aria-selected="false" tabindex="-1" id="' + listId + '-' + (k++) +
                  '" href="' + escapeHtml(href) + '">' + inner + '</a>';
              }
              if (makes.length) {
                html += '<div class="suggest-label" role="presentation">Makes</div>';
                makes.forEach(function (make) {
                  html += option('/cars?selectmake=' + encodeURIComponent(make), escapeHtml(make));
                });
              }
              if (models.length) {
                html += '<div class="suggest-label" role="presentation">Models</div>';
                models.forEach(function (car) {
                  html += option('/cars/car?make=' + encodeURIComponent(car.make) + '&model=' + encodeURIComponent(car.model),
                    '<span class="suggest-make">' + escapeHtml(car.make) + '</span>' + escapeHtml(car.model));
                });
              }
              dropdown.innerHTML = html;
              renderedQuery = q;
              active = -1;
              input.removeAttribute('aria-activedescendant');
              if (html) show();
              else hide();
            })
            .catch(function () {
              // A failed older request must not close a newer result.
              if (current(id, q)) hide();
            });
        }, 200);
      }
      input.addEventListener('input', requestSuggestions);

      // Keep focus in the combobox while following a mouse-selected option.
      dropdown.addEventListener('mousedown', function (event) { event.preventDefault(); });
      input.addEventListener('blur', function () { invalidate(false); });
      document.addEventListener('click', function (event) {
        if (!wrap.contains(event.target)) invalidate(false);
      });
      input.addEventListener('focus', function () {
        if (renderedQuery === query() && items().length) show();
        else requestSuggestions();
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
