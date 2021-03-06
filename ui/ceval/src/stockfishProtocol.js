var m = require('mithril');

module.exports = function(worker, opts) {

  var work = null;
  var state = null;
  var minLegalMoves = 0;
  var startedAt = null;

  var stopped = m.deferred();
  stopped.resolve(true);

  var emit = function() {
    if (!work || !state) return;
    minLegalMoves = Math.max(minLegalMoves, state.eval.pvs.length);
    if (state.eval.pvs.length < minLegalMoves) return;
    work.emit(state);
    state = null;
  };

  if (opts.variant.key === 'fromPosition' || opts.variant.key === 'chess960')
    worker.send('setoption name UCI_Chess960 value true');
  else if (opts.variant.key === 'antichess')
    worker.send('setoption name UCI_Variant value giveaway');
  else if (opts.variant.key !== 'standard')
    worker.send('setoption name UCI_Variant value ' + opts.variant.key.toLowerCase());
  else
    worker.send('isready'); // warm up the webworker

  var processOutput = function(text) {
    if (text.indexOf('bestmove ') === 0) {
      emit();
      if (!stopped) stopped = m.deferred();
      stopped.resolve(true);
      return;
    }
    if (!work) return;

    if (text.indexOf('currmovenumber') !== -1) return;
    var matches = text.match(/depth (\d+) .*multipv (\d+) .*score (cp|mate) ([-\d]+) .*nps (\d+) .*pv (.+)/);
    if (!matches) {
      emit();
      return;
    }

    var depth = parseInt(matches[1]);
    if (depth < opts.minDepth) return;
    var multiPv = parseInt(matches[2]);
    var cp, mate;
    if (matches[3] === 'cp') cp = parseFloat(matches[4]);
    else mate = parseFloat(matches[4]);
    if (work.ply % 2 === 1) {
      if (matches[3] === 'cp') cp = -cp;
      else mate = -mate;
    }

    if (multiPv === 1) {
      emit();
      state = {
        work: work,
        eval: {
          depth: depth,
          nps: parseInt(matches[5]),
          best: matches[6].split(' ')[0],
          cp: cp,
          mate: mate,
          pvs: [],
          millis: new Date() - startedAt
        }
      };
    } else if (!state || depth < state.eval.depth) return; // multipv progress

    state.eval.pvs[multiPv - 1] = {
      cp: cp,
      mate: mate,
      pv: matches[6],
      best: matches[6].split(' ')[0]
    };

    if (multiPv === opts.multiPv) emit();
  };

  return {
    start: function(w) {
      work = w;
      state = null;
      stopped = null;
      minLegalMoves = 0;
      if (opts.threads) worker.send('setoption name Threads value ' + opts.threads());
      if (opts.hashSize) worker.send('setoption name Hash value ' + opts.hashSize());
      worker.send('setoption name MultiPV value ' + opts.multiPv());
      worker.send(['position', 'fen', work.initialFen, 'moves'].concat(work.moves).join(' '));
      worker.send('go depth ' + work.maxDepth);
      startedAt = new Date();
    },
    stop: function() {
      if (!stopped) {
        work = null;
        stopped = m.deferred();
        worker.send('stop');
      }
      return stopped;
    },
    received: processOutput
  };
};
