from backend.app.indicators.tdx import ema, macd, sma


def test_sma_is_blank_until_the_window_is_full() -> None:
    assert sma([1, 2, 3, 4, 5], 3) == [None, None, 2.0, 3.0, 4.0]


def test_ema_is_seeded_from_the_first_close() -> None:
    values = ema([1, 2, 3, 4, 5, 6, 7, 8], 2)
    assert values[0] == 1
    assert abs(values[1] - 5 / 3) < 1e-12
    assert abs(values[2] - 23 / 9) < 1e-12
    assert abs(values[7] - 7.5002286237) < 1e-9


def test_macd_histogram_is_twice_dif_minus_dea() -> None:
    last = macd([1, 2, 3, 4, 5, 6, 7, 8], 3, 6, 2)[-1]
    dif, dea, histogram = last
    assert abs(dif - 1.2706512346) < 1e-9
    assert abs(dea - 1.2190019505) < 1e-9
    assert abs(histogram - 0.1032985682) < 1e-9
    assert abs(histogram - (dif - dea) * 2) < 1e-12
