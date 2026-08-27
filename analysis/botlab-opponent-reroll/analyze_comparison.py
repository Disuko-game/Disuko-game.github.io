from __future__ import annotations
import argparse,json,math,random
from pathlib import Path
from statistics import mean
D=["very-easy","easy","medium","hard"]; R={v:i for i,v in enumerate(D)}
def readj(p): return json.loads(p.read_text(encoding="utf-8"))
def readjl(p): return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x]
def pct(v,q):
    v=sorted(v); x=(len(v)-1)*q; a=math.floor(x); b=math.ceil(x)
    return v[a] if a==b else v[a]*(b-x)+v[b]*(x-a)
def boot_ratio(pairs,num,den,seed,samples=5000):
    rng=random.Random(seed); vals=[]
    for _ in range(samples):
        n=d=0
        for _ in pairs:
            off,on=pairs[rng.randrange(len(pairs))]; n+=num(off,on); d+=den(off,on)
        vals.append(n/d if d else 0)
    n=sum(num(a,b) for a,b in pairs); d=sum(den(a,b) for a,b in pairs)
    return {"difference":n/d if d else 0,"ci_low":pct(vals,.025),"ci_high":pct(vals,.975)}
def boot_mean(pairs,fn,seed,samples=5000):
    diffs=[fn(b)-fn(a) for a,b in pairs]; rng=random.Random(seed)
    vals=[mean(diffs[rng.randrange(len(diffs))] for _ in diffs) for _ in range(samples)]
    return {"difference":mean(diffs),"ci_low":pct(vals,.025),"ci_high":pct(vals,.975)}
def winpop(g):
    if g.get("winnerSeat") is None:return None
    return next(s["populationId"] for s in g["seats"] if s["seat"]==g["winnerSeat"])
def apps(g,d): return sum(s["populationId"]==d for s in g["seats"])
def upset(g):
    w=winpop(g)
    if w is None:return None
    strongest=max((R[s["populationId"]] for s in g["seats"] if s["seat"]!=g["winnerSeat"]),default=R[w])
    return None if strongest==R[w] else float(R[w]<strongest)
def traces(games):
    out={d:{"opponent_rerolls":0,"all_rerolls":0} for d in D}; traced=allr=opp=0
    for g in games:
        if "actionLog" not in g or "finalState" not in g:continue
        traced+=1; owners={x["id"]:x["ownerId"] for x in g["finalState"]["dice"]}
        for rec in g["actionLog"]:
            act=rec["action"]
            if act["type"]!="reroll":continue
            allr+=1; d=next(s["populationId"] for s in g["seats"] if s["seat"]==rec["seat"])
            out[d]["all_rerolls"]+=1
            if any(owners.get(x)!=rec["playerId"] for x in act["dieIds"]):
                opp+=1; out[d]["opponent_rerolls"]+=1
    return {"traced_games":traced,"all_rerolls":allr,"opponent_rerolls":opp,
      "opponent_rerolls_per_traced_game":opp/traced if traced else 0,
      "opponent_share_of_rerolls":opp/allr if allr else 0,"by_difficulty":out}
def metrics(summary,games):
    return {"games":len(games),"completed_games":summary["completedGames"],
      "population_win_rates":{d:summary["populationWinRates"][d] for d in D},
      "strategy_spread":summary["luckSkill"]["strategySpread"],"upset_rate_botlab":summary["upsetRate"],
      "natural_starter_lift":summary["luckSkill"]["naturalStarterLift"],
      "forced_starter_lift":summary["luckSkill"]["forcedStarterLift"],
      "starter_win_rate_by_player_count":summary["starter"]["byPlayerCount"],
      "average_turns":summary["averageTurns"],"average_actions":summary["averageActions"],
      "rerolls_per_game":summary["actionTotals"]["rerolls"]/len(games),
      "termination_reasons":summary["terminationReasons"],"trace_usage":traces(games)}
def main():
    p=argparse.ArgumentParser(); p.add_argument("--off",required=True,type=Path)
    p.add_argument("--on",required=True,type=Path); p.add_argument("--output",required=True,type=Path); a=p.parse_args()
    og,ng=readjl(a.off/"games.jsonl"),readjl(a.on/"games.jsonl"); os,ns=readj(a.off/"summary.json"),readj(a.on/"summary.json")
    ob,nb={g["index"]:g for g in og},{g["index"]:g for g in ng}
    if set(ob)!=set(nb):raise ValueError("A/B game indexes differ")
    pairs=[(ob[i],nb[i]) for i in sorted(ob)]; mismatches=[]
    for x,y in pairs:
        sx=(x["seed"],x["playerCount"],x["starterMode"],x["starterSeat"],[(s["seat"],s["populationId"],s["strategyHash"]) for s in x["seats"]])
        sy=(y["seed"],y["playerCount"],y["starterMode"],y["starterSeat"],[(s["seat"],s["populationId"],s["strategyHash"]) for s in y["seats"]])
        if sx!=sy:mismatches.append(x["index"])
    if mismatches:raise ValueError(f"{len(mismatches)} schedule mismatches")
    rows=[]
    for d in D:
        b=boot_ratio(pairs,lambda x,y,d=d:int(winpop(y)==d)-int(winpop(x)==d),lambda x,y,d=d:apps(x,d),20260825+R[d])
        rows.append({"difficulty":d,"off_wins":os["populationWinRates"][d]["wins"],"on_wins":ns["populationWinRates"][d]["wins"],
          "scheduled_appearances":sum(apps(g,d) for g in og),
          "off_rate":os["populationWinRates"][d]["wins"]/sum(apps(g,d) for g in og),
          "on_rate":ns["populationWinRates"][d]["wins"]/sum(apps(g,d) for g in ng),
          "off_completed_rate":os["populationWinRates"][d]["rate"],"on_completed_rate":ns["populationWinRates"][d]["rate"],
          "difference":b["difference"],
          "difference_ci_low":b["ci_low"],"difference_ci_high":b["ci_high"]})
    eligible=[p for p in pairs if upset(p[0]) is not None and upset(p[1]) is not None]
    effects={"winner_population_changed_rate":mean(winpop(x)!=winpop(y) for x,y in pairs),
      "completion_rate_change":boot_mean(pairs,lambda g:float(g.get("winnerSeat") is not None),20260830),
      "hard_minus_very_easy_spread_change":boot_ratio(pairs,
        lambda x,y:int(winpop(y)=="hard")-int(winpop(y)=="very-easy")-int(winpop(x)=="hard")+int(winpop(x)=="very-easy"),
        lambda x,y:apps(x,"hard"),20260832),
      "competitive_upset_rate_change":boot_mean(eligible,lambda g:upset(g),20260831),
      "starter_win_rate_change":boot_mean(pairs,lambda g:float(g.get("winnerSeat")==g["starterSeat"]),20260833),
      "average_turns_change":boot_mean(pairs,lambda g:g["turns"],20260834),
      "average_actions_change":boot_mean(pairs,lambda g:g["actions"],20260835),
      "rerolls_per_game_change":boot_mean(pairs,lambda g:g["metrics"]["rerolls"],20260836)}
    out={"analysis_version":1,"design":{"matched_games_per_condition":len(pairs),"total_games":2*len(pairs),
      "difficulties":D,"player_counts":[2,3,4],"same_schedule_mismatches":len(mismatches),"bootstrap_samples":5000},
      "off":metrics(os,og),"on":metrics(ns,ng),"population_comparison":rows,"paired_effects":effects,
      "sources":{"off_run":str(a.off),"on_run":str(a.on)}}
    a.output.parent.mkdir(parents=True,exist_ok=True); a.output.write_text(json.dumps(out,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(out,indent=2))
if __name__=="__main__":main()