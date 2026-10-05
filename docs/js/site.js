/* Chopper Noise (choppernoise.publicworks.nyc) / shared behavior
   ------------------------------------------------------------------
   Formatting, data loading, URL parameters and the chrome. Every page
   loads this first. No dependencies. */

(function () {
  'use strict';

  var REPO = 'https://github.com/jaramana/choppernoise.publicworks.nyc';

  // ---- Formatting -------------------------------------------------

  var whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

  var fmt = {
    num: function (n) {
      return n === null || n === undefined || isNaN(n) ? '—' : whole.format(n);
    },

    // Modeled counts are rounded so they do not claim more precision than
    // the model has: tens under a thousand, hundreds under a million.
    people: function (n) {
      if (n === null || n === undefined || isNaN(n)) return '—';
      if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + ' million';
      if (n >= 1000) return whole.format(Math.round(n / 100) * 100);
      if (n >= 100) return whole.format(Math.round(n / 10) * 10);
      return whole.format(n);
    },

    // Seconds after local midnight, as a clock reads.
    clock: function (s) {
      var m = Math.floor(s / 60) % 1440;
      var h = Math.floor(m / 60), mm = m % 60;
      return ((h + 11) % 12 + 1) + ':' + (mm < 10 ? '0' : '') + mm + (h < 12 ? ' am' : ' pm');
    },

    minutes: function (s) {
      var m = Math.round(s / 60);
      return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
    },

    // 2026-08-15 as 15 August 2026.
    date: function (iso) {
      return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
      }).format(new Date(iso + 'T00:00:00Z'));
    },

    // 2026-08-15 as Sat 15 Aug.
    shortDate: function (iso) {
      var d = new Date(iso + 'T00:00:00Z');
      return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' +
        ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    }
  };

  // ---- Data -------------------------------------------------------

  var cache = {};

  // Relative, so the site works at a subpath as readily as at a bare domain.
  // Each load checks with the server, so a rebuilt file never meets an
  // older script; an unchanged file costs one small reply.
  function load(path) {
    if (!cache[path]) {
      cache[path] = fetch('data/' + path, { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('Could not load ' + path + ' (' + r.status + ').');
        return r.json();
      });
    }
    return cache[path];
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  // ---- URL parameters ---------------------------------------------

  function params() {
    return new URLSearchParams(window.location.search);
  }

  // Replace rather than push: the view is a link to send, not a history.
  function setParams(values) {
    var u = new URL(window.location);
    Object.keys(values).forEach(function (k) {
      var v = values[k];
      if (v === null || v === undefined || v === '') u.searchParams.delete(k);
      else u.searchParams.set(k, v);
    });
    history.replaceState({}, '', u);
  }

  // ---- Chrome -----------------------------------------------------
  // Masthead and footer are written once here rather than on every page.

  var PAGES = [
    { href: 'index.html', nav: 'Map' },
    { href: 'data.html',  nav: 'Data' },
    { href: 'about.html', nav: 'About' }
  ];

  // The disclaimer, word for word wherever it appears. Only the agency
  // changes between publicworks.nyc projects.
  var COLOPHON =
    '<p class="colophon"><strong>This is not an official product.</strong> ' +
      'It is an independent initiative, not affiliated with, endorsed by, ' +
      'or produced by the <a href="https://www.faa.gov/">Federal Aviation ' +
      'Administration</a> or the City of New York. Please refer to them for ' +
      'authoritative information.</p>';

  var PORTFOLIO =
    '<p class="portfolio">A <a href="https://publicworks.nyc/">publicworks.nyc</a> project.</p>';

  function buildChrome() {
    var here = location.pathname.split('/').pop() || 'index.html';

    var head = document.querySelector('[data-chrome="masthead"]');
    if (head) {
      head.className = 'masthead';
      head.innerHTML =
        '<div class="wrap masthead-inner">' +
          '<a class="wordmark" href="index.html">Chopper Noise</a>' +
          '<nav class="nav" aria-label="Sections">' +
            PAGES.map(function (p) {
              return '<a href="' + p.href + '"' +
                (p.href === here ? ' aria-current="page"' : '') + '>' + p.nav + '</a>';
            }).join('') +
          '</nav>' +
        '</div>';
    }

    var foot = document.querySelector('[data-chrome="footer"]');
    // The map keeps only the notice and the portfolio line, at the foot of
    // the side panel. The masthead links the site's own pages; About links
    // the source and the issue tracker.
    if (foot && foot.hasAttribute('data-compact')) {
      foot.className = 'footer footer-compact';
      foot.innerHTML = COLOPHON + PORTFOLIO;
    } else if (foot) {
      foot.className = 'footer';
      foot.innerHTML =
        '<div class="wrap"><div class="footer-grid">' +
          '<div><h4>Views</h4><ul>' +
            '<li><a href="index.html">Map</a></li>' +
          '</ul></div>' +
          '<div><h4>Reference</h4><ul>' +
            '<li><a href="data.html">Data</a></li>' +
            '<li><a href="about.html">About</a></li>' +
          '</ul></div>' +
          '<div><h4>Sources</h4><ul>' +
            '<li><a href="https://adsb.lol/">adsb.lol flight archive</a></li>' +
            '<li><a href="https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.2020.html">Census 2020 blocks</a></li>' +
            '<li><a href="https://registry.faa.gov/">FAA aircraft registry</a></li>' +
            '<li><a href="https://mesonet.agron.iastate.edu/request/download.phtml">Iowa Environmental Mesonet</a></li>' +
            '<li><a href="https://www.caa.co.uk/">UK CAA noise database</a></li>' +
          '</ul></div>' +
          '<div><h4>Project</h4><ul>' +
            '<li><a href="' + REPO + '">Source on GitHub</a></li>' +
            '<li><a href="' + REPO + '/issues">Report an error</a></li>' +
          '</ul></div>' +
        '</div>' + COLOPHON + PORTFOLIO + '</div>';
    }
  }

  document.addEventListener('DOMContentLoaded', buildChrome);

  window.HO = {
    fmt: fmt, load: load, el: el, escapeHtml: escapeHtml,
    params: params, setParams: setParams
  };
})();
