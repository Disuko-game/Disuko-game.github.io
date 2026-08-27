import type { ExperimentSpec, ExperimentSummary, GameResult } from "./types";

export function buildHtmlReport(
  spec: ExperimentSpec,
  summary: ExperimentSummary,
  results: GameResult[]
): string {
  const traces = results.filter((result) => result.actionLog?.length).map((result) => ({
    index: result.index,
    seed: result.seed,
    playerCount: result.playerCount,
    starterSeat: result.starterSeat,
    winnerSeat: result.winnerSeat,
    terminationReason: result.terminationReason,
    traceTruncated: result.traceTruncated,
    seats: result.seats,
    actionLog: result.actionLog
  }));
  const payload = JSON.stringify({ spec, summary, traces })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return REPORT_DOCUMENT
    .replace("__REPORT_TITLE__", escapeHtml(spec.name))
    .replace("__REPORT_DATA__", payload);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
  })[character] as string);
}

const REPORT_DOCUMENT = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,">
<title>__REPORT_TITLE__ · Disuko Bot Lab</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-rounded,"Trebuchet MS",system-ui,sans-serif;background:#160904;color:#ffe5aa}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% -10%,#572513 0,#291006 42%,#120603 100%);padding:28px}
main{width:min(1220px,100%);margin:auto}
.report-header{margin:0 0 20px;padding:0 4px}.eyebrow{margin:0 0 6px;text-transform:uppercase;letter-spacing:.13em;font-size:.76rem;color:#eab66c}.report-header h1{margin:0;font-size:clamp(1.8rem,4vw,3rem);text-shadow:0 2px #210b03}.subtitle{color:#d9ae79;margin:.45rem 0 0}
.panel{padding:22px;border:3px solid #ffe09a;border-radius:22px;background:linear-gradient(145deg,#e7b76e,#bd7838);box-shadow:inset 0 2px 0 #fff2bd,0 12px 28px #090200b8;color:#240a02}
.tabs{display:flex;gap:8px;overflow-x:auto;padding:0 0 18px;scrollbar-width:thin}
.tabs button{flex:0 0 auto;border:0;border-radius:11px;padding:12px 16px;background:linear-gradient(#4a1808,#260902);color:#ffe7a7;font:800 .9rem inherit;box-shadow:inset 0 1px #8d4d2d,0 2px 4px #5b2b14;cursor:pointer}
.tabs button:hover,.tabs button:focus-visible{filter:brightness(1.16);outline:2px solid #fff0b2;outline-offset:2px}
.tabs button.active{box-shadow:inset 0 -3px #149cff,0 2px 4px #5b2b14}
.stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:18px}
.stat{min-height:82px;padding:15px;border-radius:12px;background:#351006;color:#ffe6a0;box-shadow:inset 0 1px #642615}
.stat small{display:block;margin-bottom:8px}.stat strong{font-size:1.45rem}
h2,h3{margin:20px 8px 10px}h2:first-child,h3:first-child{margin-top:0}
.table-wrap{overflow:auto;margin-bottom:18px}
table{width:100%;border-collapse:collapse;min-width:580px}
th,td{text-align:left;padding:11px 10px;border-bottom:1px solid #8c5128}th{font-size:.86rem;color:#1e0802}
td code{white-space:normal}.muted{color:#6c351d}.empty,.notice{padding:18px;border-radius:12px;background:#dba45e;color:#4a1d0d}
.notice{margin-bottom:16px}.warning{background:#733012;color:#ffe3a1}
.metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.metric{padding:13px;border-radius:10px;background:#cf9451}
.replay-picker{display:flex;align-items:center;gap:10px;margin-bottom:15px}.replay-picker select{max-width:100%;padding:10px;border-radius:9px;background:#351006;color:#ffe6a0;border:1px solid #9d572e}
details{margin:8px 0;border-radius:10px;background:#c98b49;overflow:hidden}summary{cursor:pointer;padding:12px;font-weight:800}pre{margin:0;padding:14px;max-height:480px;overflow:auto;background:#260a03;color:#ffe9b7;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
footer{color:#b98152;text-align:center;padding:18px}
@media(max-width:760px){body{padding:10px}.panel{padding:13px;border-radius:16px}.stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.metric-grid{grid-template-columns:1fr}.tabs button{padding:10px 12px}}
</style>
</head>
<body>
<main>
<header class="report-header"><p class="eyebrow">Disuko Bot Laboratory · CLI report</p><h1 id="title"></h1><p class="subtitle" id="subtitle"></p></header>
<section class="panel">
<nav class="tabs" aria-label="Report sections">
<button data-tab="overview">overview</button><button data-tab="matchups">matchups</button><button data-tab="first-player">first-player</button><button data-tab="player-count">player-count</button><button data-tab="luck-skill">luck-skill</button><button data-tab="situational">situational</button><button data-tab="optimization">optimization</button><button data-tab="replay">replay</button>
</nav>
<div id="content"></div>
</section>
<footer>Generated locally from deterministic Bot Lab artifacts.</footer>
</main>
<script type="application/json" id="report-data">__REPORT_DATA__</script>
<script>
(function(){
  'use strict';
  var data=JSON.parse(document.getElementById('report-data').textContent);
  var summary=data.summary;
  var tabs=['overview','matchups','first-player','player-count','luck-skill','situational','optimization','replay'];
  var content=document.getElementById('content');
  document.getElementById('title').textContent=data.spec.name;
  document.getElementById('subtitle').textContent=summary.games+' scheduled games · seed '+data.spec.seed;

  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function pct(value){return (Number(value||0)*100).toFixed(1)+'%'}
  function number(value,digits){return Number(value||0).toFixed(digits==null?1:digits)}
  function stat(label,value){return '<div class="stat"><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>'}
  function statGrid(items){return '<div class="stat-grid">'+items.map(function(item){return stat(item[0],item[1])}).join('')+'</div>'}
  function rateTable(rates,label){
    var entries=Object.entries(rates||{}).sort(function(a,b){return b[1].rate-a[1].rate});
    if(!entries.length)return '<p class="empty">No data was recorded for this view.</p>';
    return '<div class="table-wrap"><table><thead><tr><th>'+esc(label||'Configuration')+'</th><th>Win rate</th><th>95% CI</th><th>Sample</th></tr></thead><tbody>'+
      entries.map(function(entry){var id=entry[0],rate=entry[1];return '<tr><td>'+esc(id)+'</td><td>'+pct(rate.rate)+'</td><td>'+pct(rate.low)+'–'+pct(rate.high)+'</td><td>'+rate.wins+'/'+rate.games+'</td></tr>'}).join('')+
      '</tbody></table></div>';
  }
  function warnings(){
    return (summary.warnings||[]).map(function(message){return '<p class="notice warning">'+esc(message)+'</p>'}).join('');
  }
  function overview(){
    return warnings()+statGrid([
      ['Completed',summary.completedGames],
      ['Throughput',number(summary.gamesPerSecond,2)+'/s'],
      ['Avg turns',number(summary.averageTurns,1)],
      ['Upsets',pct(summary.upsetRate.rate)]
    ])+rateTable(summary.strategyWinRates,'Configuration');
  }
  function matchups(){return '<h2>Head-to-head matchups</h2>'+rateTable(summary.matchups,'Winner > opponent')}
  function firstPlayer(){
    var html=statGrid([
      ['Natural starter',pct(summary.starter.naturalStarterWinRate.rate)],
      ['Forced starter',pct(summary.starter.forcedStarterWinRate.rate)],
      ['Opening tie rounds',pct(summary.starter.openingTieRoundRate)],
      ['Seed sensitivity',pct(summary.seedSensitivity)]
    ]);
    html+='<h2>Starter win rate by player count</h2>'+rateTable(summary.starter.byPlayerCount,'Players');
    html+='<h2>Strategy and starter interaction</h2>'+rateTable(summary.starter.strategyInteraction,'Strategy | position');
    return html;
  }
  function playerCount(){
    var groups=Object.entries(summary.playerCountWinRates||{});
    if(!groups.length)return '<p class="empty">No player-count breakdown is available.</p>';
    return groups.map(function(group){return '<h2>'+esc(group[0])+' players</h2>'+rateTable(group[1],'Configuration')}).join('');
  }
  function luckSkill(){
    var boot=summary.luckSkill.forcedStarterBootstrap;
    return statGrid([
      ['Strategy spread',pct(summary.luckSkill.strategySpread)],
      ['Natural starter lift',pct(summary.luckSkill.naturalStarterLift)],
      ['Forced starter lift',pct(summary.luckSkill.forcedStarterLift)],
      ['Seed sensitivity',pct(summary.seedSensitivity)]
    ])+
    '<p class="notice">Forced-starter paired bootstrap: '+pct(boot.mean)+' ('+pct(boot.low)+'–'+pct(boot.high)+'). Equal-strategy games establish the luck, seat, and starter baseline; mixed leagues measure strategy lift.</p>'+
    '<div class="metric-grid">'+
      '<div class="metric"><strong>'+summary.averageActions.toFixed(1)+'</strong><br>average actions</div>'+
      '<div class="metric"><strong>'+summary.actionTotals.rerolls+'</strong><br>rerolls</div>'+
      '<div class="metric"><strong>'+summary.actionTotals.actionCreditsEarned+'</strong><br>action credits earned</div>'+
    '</div>';
  }
  function situational(){return '<h2>Situational strategy results</h2><p class="muted">Keys show player count, game phase, tray state, action credits, tray diversity, and strategy.</p>'+rateTable(summary.situationalWinRates,'Situation')}
  function optimization(){
    return '<h2>Configuration candidates</h2><p class="notice">This tournament report ranks the configurations it tested. The optimizer never edits shipped presets automatically; promotion remains an explicit review step.</p>'+rateTable(summary.strategyWinRates,'Configuration');
  }
  function replay(){
    if(!data.traces.length)return '<p class="empty">No replay was sampled. Set traceEvery to a smaller number and rerun the experiment.</p>';
    var options=data.traces.map(function(game,index){return '<option value="'+index+'">Game '+game.index+' · '+esc(game.seed)+' · '+game.playerCount+' players</option>'}).join('');
    return '<div class="replay-picker"><label for="replay-game"><strong>Sampled game</strong></label><select id="replay-game">'+options+'</select></div><div id="replay-detail"></div>';
  }
  function renderReplay(index){
    var game=data.traces[index]||data.traces[0];
    var target=document.getElementById('replay-detail');
    if(!target||!game)return;
    var note=game.traceTruncated?'<p class="notice warning">This replay was truncated at the configured trace-action limit.</p>':'';
    target.innerHTML=note+'<p class="muted">Starter seat '+game.starterSeat+' · winner '+(game.winnerSeat==null?'none':'seat '+game.winnerSeat)+' · '+esc(game.terminationReason)+'</p>'+
      game.actionLog.map(function(record){return '<details><summary>#'+(record.actionIndex+1)+' · turn '+record.turnNumber+' · '+esc(record.strategyId)+' · '+esc(record.action.type)+'</summary><pre>'+esc(JSON.stringify(record,null,2))+'</pre></details>'}).join('');
  }
  var renderers={'overview':overview,'matchups':matchups,'first-player':firstPlayer,'player-count':playerCount,'luck-skill':luckSkill,'situational':situational,'optimization':optimization,'replay':replay};
  function render(tab){
    if(tabs.indexOf(tab)<0)tab='overview';
    document.querySelectorAll('[data-tab]').forEach(function(button){button.classList.toggle('active',button.dataset.tab===tab)});
    content.innerHTML=renderers[tab]();
    if(tab==='replay'&&data.traces.length){
      var picker=document.getElementById('replay-game');
      picker.addEventListener('change',function(){renderReplay(Number(picker.value))});
      renderReplay(0);
    }
    if(location.hash!=='#'+tab)history.replaceState(null,'','#'+tab);
  }
  document.querySelectorAll('[data-tab]').forEach(function(button){button.addEventListener('click',function(){render(button.dataset.tab)})});
  window.addEventListener('hashchange',function(){render(location.hash.slice(1))});
  render(location.hash.slice(1)||'overview');
})();
</script>
</body>
</html>`;
