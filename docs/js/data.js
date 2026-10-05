/* Chopper Noise (choppernoise.publicworks.nyc) / the Data page
   ------------------------------------------------------------------
   Fills the build date, the sample days and the type levels from
   meta.json, so none of them is typed by hand. Loads after site.js. */

(function () {
  'use strict';

  var fmt = HO.fmt;

  // Sunday 2 August, Saturday 15 August and Wednesday 16 September 2026.
  function dayList(days) {
    var names = days.map(function (d) {
      return d.weekday + ' ' + fmt.date(d.day).replace(/ \d{4}$/, '');
    });
    var last = names.pop();
    var year = days[days.length - 1].day.slice(0, 4);
    return (names.length ? names.join(', ') + ' and ' : '') + last + ' ' + year;
  }

  // Loudest first. A type that borrows another's level says which.
  function typeRows(meta) {
    var band = meta.bands.indexOf(60);
    return Object.keys(meta.types).sort(function (a, b) {
      return meta.types[b].l150 - meta.types[a].l150 || a.localeCompare(b);
    }).map(function (code) {
      var t = meta.types[code];
      var name = code === 'unknown' ? 'Type not sent' : meta.names[code] || code;
      var basis = t.basis === code ? '' :
        ' <span class="fine">(' + HO.escapeHtml(meta.names[t.basis] || t.basis) + ' level)</span>';
      return '<tr><td>' + HO.escapeHtml(name) + basis + '</td>' +
        '<td class="num">' + t.l150.toFixed(1) + '</td>' +
        '<td class="num">' + fmt.num(t.reach[band]) + ' m</td></tr>';
    }).join('');
  }

  document.addEventListener('DOMContentLoaded', function () {
    HO.load('meta.json').then(function (meta) {
      var built = document.getElementById('built');
      built.textContent = 'Data built ' + fmt.date(meta.built) + '.';
      built.hidden = false;
      document.getElementById('source-days').textContent = dayList(meta.days);
      document.getElementById('type-rows').innerHTML = typeRows(meta);
    }).catch(function () {
      document.getElementById('type-rows').innerHTML =
        '<tr><td colspan="3">The type levels did not load. They are in the metadata download.</td></tr>';
    });
  });
})();
