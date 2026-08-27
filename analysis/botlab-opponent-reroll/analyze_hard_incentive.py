from __future__ import annotations
import argparse,json,math,random
from collections import Counter,defaultdict
from pathlib import Path
from statistics import mean

CONTROL="hard-control"
INCENTIVE="hard-incentive"

def readjl(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
def pct(values,q):
    values=sorted(values); pos=(len(values)-1)*q; lo=math.floor(pos); hi=math.ceil(pos)
    return values[lo] if lo==hi else values[lo]*(hi-pos)+values[hi]*(pos-lo)
def winner(g):
    if g.get("winnerSeat") is None:return None
    return next(s["populationId"] for s in g["seats"] if s["seat"]==g["winnerSeat"])
def treatment_started(g):
    seat=next(s["seat"] for s in g["seats"] if s["populationId"]==INCENTIVE)
    return g["starterSeat"]==seat
def rate(games,pop):
    completed=[g for g in games if winner(g) is not None]
    return sum(winner(g)==pop for g in completed)/len(completed) if completed else 0
def group_bootstrap(groups,samples=10000,seed=20260825):
    rng=random.Random(seed); keys=sorted(groups); estimates=[]
    for _ in range(samples):
        sampled=[g for _ in keys for g in groups[keys[rng.randrange(len(keys))]]]
        estimates.append(rate(sampled,INCENTIVE))
    point=rate([g for rows in groups.values() for g in rows],INCENTIVE)
    return {"rate":point,"ci_low":pct(estimates,.025),"ci_high":pct(estimates,.975),"samples":samples}
def permutation_p(groups,samples=100000,seed=20260826):
    nets=[sum(winner(g)==INCENTIVE for g in rows)-sum(winner(g)==CONTROL for g in rows) for rows in groups.values()]
    observed=abs(sum(nets)); rng=random.Random(seed); extreme=0
    for _ in range(samples):
        value=sum(net if rng.random()<.5 else -net for net in nets)
        extreme+=abs(value)>=observed
    return (extreme+1)/(samples+1)
def trace_usage(games):
    out={p:{"actions":0,"rerolls":0,"opponent_rerolls":0,"games_with_opponent_reroll":set()} for p in [CONTROL,INCENTIVE]}
    traced=0; truncated=0
    for g in games:
        if "actionLog" not in g or "finalState" not in g:continue
        traced+=1; truncated+=int(bool(g.get("traceTruncated")))
        owners={d["id"]:d["ownerId"] for d in g["finalState"]["dice"]}
        for rec in g["actionLog"]:
            pop=next(s["populationId"] for s in g["seats"] if s["seat"]==rec["seat"])
            out[pop]["actions"]+=1
            act=rec["action"]
            if act["type"]!="reroll":continue
            out[pop]["rerolls"]+=1
            if any(owners.get(die)!=rec["playerId"] for die in act["dieIds"]):
                out[pop]["opponent_rerolls"]+=1; out[pop]["games_with_opponent_reroll"].add(g["index"])
    for values in out.values():
        values["games_with_opponent_reroll"]=len(values["games_with_opponent_reroll"])
        values["opponent_rerolls_per_traced_game"]=values["opponent_rerolls"]/traced if traced else 0
        values["opponent_reroll_action_share"]=values["opponent_rerolls"]/values["actions"] if values["actions"] else 0
    return {"traced_games":traced,"truncated_traces":truncated,"by_population":out}
def main():
    p=argparse.ArgumentParser();p.add_argument("--run",type=Path,required=True);p.add_argument("--output",type=Path,required=True);a=p.parse_args()
    games=readjl(a.run/"games.jsonl")
    populations=json.loads((a.run/"populations.json").read_text(encoding="utf-8"))
    treatment_incentive=next(p for p in populations if p["id"]==INCENTIVE)["strategies"][0]["weights"]["opponentReroll"]
    if len(games)!=1200:raise ValueError(f"Expected 1200 games, found {len(games)}")
    if any(Counter(s["populationId"] for s in g["seats"])!=Counter({CONTROL:1,INCENTIVE:1}) for g in games):
        raise ValueError("Every game must contain exactly one control and one incentive Hard bot")
    groups=defaultdict(list)
    for g in games:groups[g["pairGroup"]].append(g)
    if len(groups)!=400 or any(len(rows)!=3 for rows in groups.values()):raise ValueError("Expected 400 matched natural/forced triplets")
    counts=Counter(winner(g) or "no-winner" for g in games); completed=1200-counts["no-winner"]
    bootstrap=group_bootstrap(groups)
    slices={}
    definitions={
      "natural":"Natural opening-roll starter",
      "incentive-starts":"Forced: incentive bot starts",
      "control-starts":"Forced: control bot starts"}
    slice_games={
      "natural":[g for g in games if g["starterMode"]=="natural"],
      "incentive-starts":[g for g in games if g["starterMode"]=="forced" and treatment_started(g)],
      "control-starts":[g for g in games if g["starterMode"]=="forced" and not treatment_started(g)]}
    for key,rows in slice_games.items():
        done=[g for g in rows if winner(g)]
        slices[key]={"label":definitions[key],"games":len(rows),"completed":len(done),
          "incentive_wins":sum(winner(g)==INCENTIVE for g in done),
          "control_wins":sum(winner(g)==CONTROL for g in done),
          "incentive_win_rate":rate(rows,INCENTIVE)}
    out={"analysis_version":1,"design":{"games":1200,"matched_triplets":400,"player_count":2,
      "opponent_rerolls_enabled_for_both":True,"control_incentive":0,"treatment_incentive":treatment_incentive},
      "outcomes":{"completed":completed,"completion_rate":completed/1200,
        "control_wins":counts[CONTROL],"incentive_wins":counts[INCENTIVE],"no_winner":counts["no-winner"],
        "incentive_win_rate_completed":bootstrap["rate"],"incentive_win_rate_ci_low":bootstrap["ci_low"],
        "incentive_win_rate_ci_high":bootstrap["ci_high"],"triplet_permutation_p":permutation_p(groups)},
      "starter_slices":slices,"game_flow":{"average_turns":mean(g["turns"] for g in games),
        "average_actions":mean(g["actions"] for g in games),"termination_reasons":dict(Counter(g["terminationReason"] for g in games))},
      "trace_usage":trace_usage(games),"source_run":str(a.run)}
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(out,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(out,indent=2))
if __name__=="__main__":main()