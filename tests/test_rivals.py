

def test_a_short_race_plans_fewer_stops_than_the_full_distance():
    """Regression (B18): the stop count came from the full-distance distribution, so a 15-lap race got stints of 3 or 4 laps."""
    from engine.rivals.policy import RulePolicy
    from tests.helpers import make_bundle
    b = make_bundle()
    full = b["circuits"]["Test"]["total_laps"]
    b["circuits"]["Test"]["stops_distribution"] = {"2": 1.0, "3": 1.0}
    sets = {"SOFT": 4, "MEDIUM": 4, "HARD": 4}
    long_race = RulePolicy("T0", 1, b, "Test", full)
    short = RulePolicy("T0", 1, b, "Test", max(4, full // 4))
    assert {len(long_race._plan(f"c{i}", "MEDIUM", sets)) - 1 for i in range(40)} <= {2, 3}
    stops = {len(short._plan(f"c{i}", "MEDIUM", sets)) - 1 for i in range(40)}
    assert stops == {1}                                                 # 2 or 3 stops scaled to a quarter of the race, at least one
    assert short._stops_for_race(0) == 0 and long_race._stops_for_race(3) == 3
