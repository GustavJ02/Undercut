"""Championship points (design section 15): the top ten score, no point for the fastest lap (decision D12)."""

POINTS = (25, 18, 15, 12, 10, 8, 6, 4, 2, 1)


def car_points(order, car_id) -> int:
    """Points of one car in a classification (list of car ids, retirements and penalised cars at the back)."""
    place = order.index(car_id)
    return POINTS[place] if place < len(POINTS) else 0


def team_result(order, car_ids) -> dict:
    """What a team got from a race: its points and the mean finishing position of its cars (the field size for a car that
    did not finish, since points alone say nothing for a team that is never in the top ten)."""
    return {"points": sum(car_points(order, c) for c in car_ids),
            "mean_position": sum(order.index(c) + 1 for c in car_ids) / len(car_ids)}
