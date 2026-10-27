"""Small synthetic bundles for tests. The numbers are arbitrary and only exercise the schema and the engine."""
import copy

_CLIFF = {"derived_from": "km_stint", "onset_age": [20, 25, 30], "onset_cdf": [0.2, 0.6, 1.0], "extra_s_per_lap": 0.3}
_SURV = {"age": [0, 10, 20, 30], "surv": [1.0, 0.8, 0.3, 0.0]}


def minimal_bundle() -> dict:
    compounds = {c: {"pace_offset_s": o, "wear_s_per_lap": w, "wear_temp_coeff": 0.0005, "cliff": copy.deepcopy(_CLIFF)}
                 for c, o, w in [("SOFT", -0.5, 0.08), ("MEDIUM", 0.0, 0.05), ("HARD", 0.3, 0.03), ("INTERMEDIATE", 0.0, 0.06),
                                 ("WET", 0.0, 0.04)]}
    return {
        "schema_version": 1,
        "bundle_version": "0.0.1",
        "source": {"generator": "tests", "priors_races": 0},
        "placeholders": [],
        "compounds": compounds,
        "temp_ref_c": 37.0,
        "fuel_s_per_lap": 0.05,
        "lap_noise_s": 0.5,
        "passing": {"a": -2.9, "b": 1.8, "window_s": 1.5},
        "safety": {"sc_rate_per_lap": 0.01, "vsc_rate_per_lap": 0.01, "sc_laps": 3.5, "vsc_laps": 1.5, "early_boost": 5.0,
                   "sc_pit_ratio": 0.45, "vsc_pit_ratio": 0.65, "sc_lap_factor": 1.45, "vsc_lap_factor": 1.3, "sc_gap_s": 0.9},
        "incidents": {"retire_per_car_lap": 0.0, "mechanical_per_car_lap": 0.0, "mechanical_on_track_share": 0.3,
                      "collision": {"rate_per_exposure_s": 0.0, "window_s": 0.5, "first_lap_boost": 1.0,
                                    "outcome": {"damage": 0.25, "retire": 0.15}, "damage_loss_s": 0.5, "contacts_per_race": 2.0},
                      "hazard_response": {"sc": 0.5, "vsc": 0.3, "red": 0.0},
                      "red_flag": {"hold_s": 30.0, "durations_min": [5.0, 20.0], "per_dry_race": 0.05}},
        "stint_pace_sd_s": 0.0,
        "strategy": {"first_stop_floor_share": 0.1},
        "weekend_pace": {"team_sd_s": 0.0, "driver_sd_s": 0.0},
        "team_orders": {"window_s": 3.0, "lift_s_per_lap": {"straight": 9.0, "link": 5.0, "corner": 3.0}, "corner_halfwidth": 0.012,
                        "straight_min_gap": 0.05, "delay_prob": 0.0, "argue_prob": 0.0, "refuse_share": 0.5, "insist_window_s": 90.0, "delay_max_s": 25.0, "timeout_s": 40.0, "hold_s": 60.0},
        "traffic": {"window_s": 1.0, "loss_s": 0.3, "min_gap_s": 0.3},
        "start": {"grid_gap_s": 0.4, "qualifying_noise_s": 0.2, "qualifying_front_share": 1.0, "reaction_mean_s": 0.2,
                  "reaction_sd_s": 0.12, "launch_tau_s": 4.0, "launch_sd": 0.25, "first_lap_logit_shift": 0.8, "launch_front_share": 1.0},
        "tyre_sets": {"SOFT": 8, "MEDIUM": 3, "HARD": 2, "INTERMEDIATE": 4, "WET": 2},
        "weather": {"scenario_probs": {"dry": 0.8, "wet_start": 0.1, "rain_during": 0.1}, "rain_durations_laps": [3, 6],
                    "rain_start_share": [0.3, 0.5], "forecast": {"given_rain": {"21-40": 3, "61-100": 2}, "given_dry": {"0-20": 5, "21-40": 1}},
                    "wet_rate_per_lap": {"light": 0.12, "heavy": 0.25}, "dry_rate_per_lap": 0.04, "dry_track_wear": 3.0,
                    "lap_delta": {"SOFT": [0, 6, 16, 28, 40], "MEDIUM": [0, 6, 16, 28, 40], "HARD": [0, 6, 16, 28, 40],
                                  "INTERMEDIATE": [4, 3.5, 7, 14, 24], "WET": [9, 8.5, 10, 12.5, 17]},
                    "multipliers": {"sc": 2.0, "vsc": 1.6, "red": 9.0, "contact": 2.0}},
        "start_compound_shares": {"SOFT": 0.2, "MEDIUM": 0.6, "HARD": 0.2},
        "transitions": {c: {n: 1 for n in ("SOFT", "MEDIUM", "HARD")} for c in ("SOFT", "MEDIUM", "HARD")},
        "stints": {"pooled": {c: copy.deepcopy(_SURV) for c in ("SOFT", "MEDIUM", "HARD")}, "circuits": {}},
        "pit_stop": {"stationary_mean_s": 2.4, "stationary_sd_s": 0.3, "slow_stop_prob": 0.05, "slow_stop_extra_s": 3.0,
                     "error_prob": 0.005, "error_extra_s": 10.0},
        "circuits": {"Test": {"total_laps": 20, "lap_length_m": 5000.0, "pit_loss_green_s": 22.0, "pit_lane_time_s": 32.0,
                              "base_lap_s": 90.0, "stops_distribution": {"1": 3, "2": 7}, "residual_sc_rate_per_lap": 0.01, "sc_response_scale": 1.0, "residual_vsc_rate_per_lap": 0.01, "pit_entry_frac": 0.95, "pit_lane_frac": 0.111, "pit_call_cutoff_frac": 0.05,
                              "passing_effect": 0.0,
                              "corners": [{"n": i + 1, "frac": f} for i, f in enumerate([0.10, 0.20, 0.40, 0.55, 0.70, 0.85])], "sc_rate_per_lap": 0.01, "vsc_rate_per_lap": 0.01}},
        "teams": [{"id": f"T{i}", "name": f"Team {i}", "pace_delta_s": 0.1 * i, "reliability": 0.98,
                   "drivers": [{"id": f"T{i}A", "name": f"Driver {i}A", "pace_delta_s": 0.0},
                               {"id": f"T{i}B", "name": f"Driver {i}B", "pace_delta_s": 0.05}]} for i in range(10)],
    }
