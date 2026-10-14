/* Chopper Noise (choppernoise.publicworks.nyc) / the Data page
   ------------------------------------------------------------------
   Fills the build date, the sample days, the dropped days and the type
   levels from meta.json, so none of them is typed by hand. Loads after
   site.js. */

(function () {
  'use strict';

  var fmt = HO.fmt;

  // Sunday 2 August as a label, without the year.
  function label(d) {
    return d.weekday + ' ' + fmt.date(d.day).replace(/ \d{4}$/, '');
  }

  function nextDay(iso) {
    return new Date(Date.parse(iso + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
  }

  // Three or more days in a row read as one span:
  // Sunday 2 August, Wednesday 16 September and Monday 5 to Sunday 11 October 2026.
  function dayList(days) {
    var parts = [], run = [];
    function flush() {
      var a = run[0], b = run[run.length - 1];
      if (run.length < 3) {
        run.forEach(function (d) { parts.push(label(d)); });
      } else {
        var start = a.day.slice(0, 7) === b.day.slice(0, 7) ? a.weekday + ' ' + +a.day.slice(8) : label(a);
        parts.push(start + ' to ' + label(b));
      }
      run = [];
    }
    days.forEach(function (d) {
      if (run.length && nextDay(run[run.length - 1].day) !== d.day) flush();
      run.push(d);
    });
    flush();
    var last = parts.pop();
    var year = days[days.length - 1].day.slice(0, 4);
    return (parts.length ? parts.join(', ') + ' and ' : '') + last + ' ' + year;
  }

  // One sentence per day the coverage check dropped.
  function droppedList(dropped) {
    return dropped.map(function (d) {
      return d.weekday + ' ' + fmt.date(d.day) + ' was dropped because its archive has ' + d.reason + '.';
    }).join(' ');
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
      document.getElementById('source-days').textContent = dayList(meta.days);
      if (meta.dropped) document.getElementById('dropped-days').textContent = droppedList(meta.dropped);
      document.getElementById('type-rows').innerHTML = typeRows(meta);
    }).catch(function () {
      document.getElementById('type-rows').innerHTML =
        '<tr><td colspan="3">The type levels did not load. They are in the metadata download.</td></tr>';
    });
  });
})();
