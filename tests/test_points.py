from scoring.points import POINTS, car_points, team_result


def test_the_top_ten_score_and_the_rest_do_not():
    order = [f"C{i}" for i in range(22)]
    assert [car_points(order, f"C{i}") for i in range(12)] == [*POINTS, 0, 0]
    assert sum(POINTS) == 101


def test_team_result_adds_points_and_averages_positions():
    order = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]
    assert team_result(order, ["A", "C"]) == {"points": 40, "mean_position": 2.0}
    assert team_result(order, ["K", "L"]) == {"points": 0, "mean_position": 11.5}
