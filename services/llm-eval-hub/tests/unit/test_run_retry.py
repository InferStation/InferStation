import pytest

from apps.api.app.api.v1.runs import _is_transient_error


@pytest.mark.parametrize(
    "error_type",
    [
        "transport.dns",
        "transport.connect",
        "transport.tls",
        "transport.timeout",
        "http.429",
        "http.500",
        "http.503",
    ],
)
def test_transient_errors_are_retryable(error_type: str) -> None:
    assert _is_transient_error(error_type)


@pytest.mark.parametrize("error_type", [None, "http.400", "http.401", "response.invalid_json"])
def test_permanent_errors_are_not_retryable(error_type: str | None) -> None:
    assert not _is_transient_error(error_type)
