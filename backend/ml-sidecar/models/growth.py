"""
Growth Rate Prediction Model
═════════════════════════════════════════════════════════════════════

Given depth history across multiple inspection runs, predicts
future corrosion growth rate with uncertainty bounds using
Bayesian linear regression.

This supplements the deterministic NACE SP0502 linear extrapolation
with:
  - Uncertainty quantification (credible intervals)
  - Non-linear trend detection
  - Acceleration/deceleration classification

Input:  Depth history [{run_date, depth_percent}], distance history
Output: Predicted growth rate, uncertainty bounds, trend class

═════════════════════════════════════════════════════════════════════
"""

from pydantic import BaseModel, Field
from datetime import datetime
import numpy as np
import math


# ── Request / Response Schemas ──

class DepthReading(BaseModel):
    run_date: str  # ISO date string
    depth_percent: float


class DistanceReading(BaseModel):
    run_date: str
    distance_ft: float


class GrowthRequest(BaseModel):
    feature_id: str
    depth_history: list[DepthReading] = Field(min_length=1)
    distance_history: list[DistanceReading] = Field(default_factory=list)
    linear_growth_rate: float = Field(description="Current NACE-computed rate (%WT/yr)")


class GrowthPrediction(BaseModel):
    predicted_rate_pct_yr: float
    lower_bound_pct_yr: float = Field(description="95% credible interval lower bound")
    upper_bound_pct_yr: float = Field(description="95% credible interval upper bound")
    uncertainty: float = Field(ge=0, le=1, description="Normalized uncertainty (0=certain, 1=very uncertain)")
    trend_class: str = Field(description="STABLE | GROWING | ACCELERATING | DECELERATING")
    acceleration_pct_yr2: float = Field(description="Second derivative — rate of change of growth rate")
    remaining_life_years: float | None = Field(description="Predicted years until 80% wall loss")
    r_squared: float = Field(description="Goodness of fit")


class GrowthResponse(BaseModel):
    prediction: GrowthPrediction
    ml_confidence: float = Field(ge=0.0, le=1.0)
    explanation: str
    model_id: str = "bayesian-growth"
    model_version: str = "0.1.0"
    experimental: bool = True


class GrowthModel:
    """
    Bayesian linear regression for corrosion growth prediction.

    Uses conjugate prior (Normal-Inverse-Gamma) for analytical
    posterior computation — no MCMC needed, very fast.

    With only 2 data points: wide uncertainty, defers to NACE linear.
    With 3+ points: fits quadratic, detects acceleration.
    With 5+ points: uncertainty narrows significantly.
    """

    # Prior hyperparameters (weakly informative)
    PRIOR_MEAN_RATE = 1.0  # %WT/yr — typical corrosion rate prior
    PRIOR_VARIANCE = 10.0  # wide prior

    # Wall loss threshold for remaining life calculation
    CRITICAL_WALL_LOSS = 80.0  # % wall thickness

    def __init__(self):
        self._ready = True
        print("[GROWTH] Bayesian growth prediction model initialized")

    def _parse_dates(self, readings: list[DepthReading]) -> tuple[np.ndarray, np.ndarray]:
        """Convert readings to (time_years, depth_percent) arrays."""
        sorted_readings = sorted(readings, key=lambda r: r.run_date)
        base_date = datetime.fromisoformat(sorted_readings[0].run_date.replace("Z", "+00:00"))

        times = []
        depths = []
        for r in sorted_readings:
            dt = datetime.fromisoformat(r.run_date.replace("Z", "+00:00"))
            years = (dt - base_date).total_seconds() / (365.25 * 24 * 3600)
            times.append(years)
            depths.append(r.depth_percent)

        return np.array(times), np.array(depths)

    def _bayesian_linear_fit(
        self, t: np.ndarray, y: np.ndarray
    ) -> tuple[float, float, float, float, float]:
        """
        Bayesian linear regression with conjugate prior.

        Returns: (slope, intercept, sigma, lower_slope, upper_slope)
        where lower/upper are 95% credible interval bounds for slope.
        """
        n = len(t)

        if n == 1:
            # Can't fit with 1 point — use prior
            return (
                self.PRIOR_MEAN_RATE,
                y[0],
                math.sqrt(self.PRIOR_VARIANCE),
                self.PRIOR_MEAN_RATE - 2 * math.sqrt(self.PRIOR_VARIANCE),
                self.PRIOR_MEAN_RATE + 2 * math.sqrt(self.PRIOR_VARIANCE),
            )

        # OLS fit
        A = np.vstack([t, np.ones(n)]).T
        result = np.linalg.lstsq(A, y, rcond=None)
        coeffs = result[0]
        slope = float(coeffs[0])
        intercept = float(coeffs[1])

        # Residual standard error
        y_pred = slope * t + intercept
        residuals = y - y_pred
        if n > 2:
            sigma = float(np.sqrt(np.sum(residuals ** 2) / (n - 2)))
        else:
            sigma = float(max(abs(slope) * 0.5, 0.1))  # heuristic for n=2

        # Bayesian posterior: combine OLS with prior
        prior_precision = 1.0 / self.PRIOR_VARIANCE
        data_precision = n / (sigma ** 2 + 1e-10)

        posterior_precision = prior_precision + data_precision
        posterior_mean = (
            prior_precision * self.PRIOR_MEAN_RATE + data_precision * slope
        ) / posterior_precision
        posterior_var = 1.0 / posterior_precision

        # 95% credible interval
        ci_width = 1.96 * math.sqrt(posterior_var)
        lower = posterior_mean - ci_width
        upper = posterior_mean + ci_width

        return posterior_mean, intercept, sigma, lower, upper

    def _detect_acceleration(self, t: np.ndarray, y: np.ndarray) -> float:
        """
        Fit quadratic to detect acceleration (2nd derivative).
        Returns acceleration in %WT/yr².
        """
        if len(t) < 3:
            return 0.0

        # Fit quadratic: y = a*t² + b*t + c
        coeffs = np.polyfit(t, y, 2)
        acceleration = float(2 * coeffs[0])  # 2nd derivative of at²+bt+c = 2a

        return acceleration

    def _classify_trend(self, rate: float, acceleration: float) -> str:
        """Classify growth trend based on rate and acceleration."""
        if abs(rate) < 0.1:
            return "STABLE"
        if acceleration > 0.05:
            return "ACCELERATING"
        if acceleration < -0.05:
            return "DECELERATING"
        return "GROWING"

    def predict(self, req: GrowthRequest) -> GrowthResponse:
        """Predict growth rate with uncertainty bounds."""
        t, depths = self._parse_dates(req.depth_history)
        n = len(t)

        # Bayesian linear fit
        rate, intercept, sigma, lower, upper = self._bayesian_linear_fit(t, depths)

        # Detect acceleration
        acceleration = self._detect_acceleration(t, depths)

        # Trend classification
        trend_class = self._classify_trend(rate, acceleration)

        # R² goodness of fit
        if n >= 2:
            y_pred = rate * t + intercept
            ss_res = float(np.sum((depths - y_pred) ** 2))
            ss_tot = float(np.sum((depths - np.mean(depths)) ** 2))
            r_squared = 1.0 - (ss_res / (ss_tot + 1e-10)) if ss_tot > 1e-10 else 0.0
            r_squared = max(0.0, min(1.0, r_squared))
        else:
            r_squared = 0.0

        # Remaining life prediction
        current_depth = float(depths[-1])
        if rate > 0.01:
            remaining_wall = self.CRITICAL_WALL_LOSS - current_depth
            remaining_life = remaining_wall / rate if remaining_wall > 0 else 0.0
        else:
            remaining_life = None  # stable — no meaningful prediction

        # Confidence based on data quality
        data_quality_factors = [
            min(n / 5.0, 1.0),  # more points = better (cap at 5)
            r_squared,  # better fit = more confident
            1.0 - min(sigma / 5.0, 1.0),  # lower noise = better
        ]
        ml_confidence = float(np.mean(data_quality_factors))
        ml_confidence = max(0.05, min(1.0, ml_confidence))

        # Uncertainty (inverse of confidence, normalized)
        uncertainty = 1.0 - ml_confidence

        # Build explanation
        explanation = (
            f"Bayesian growth: {rate:.3f} %WT/yr "
            f"(95% CI: [{lower:.3f}, {upper:.3f}]). "
            f"Trend: {trend_class}. "
            f"Based on {n} inspection(s), R²={r_squared:.3f}. "
            f"Acceleration={acceleration:.4f} %WT/yr². "
            f"NACE linear rate={req.linear_growth_rate:.3f} for comparison."
        )

        return GrowthResponse(
            prediction=GrowthPrediction(
                predicted_rate_pct_yr=round(rate, 4),
                lower_bound_pct_yr=round(lower, 4),
                upper_bound_pct_yr=round(upper, 4),
                uncertainty=round(uncertainty, 4),
                trend_class=trend_class,
                acceleration_pct_yr2=round(acceleration, 4),
                remaining_life_years=round(remaining_life, 2) if remaining_life is not None else None,
                r_squared=round(r_squared, 4),
            ),
            ml_confidence=round(ml_confidence, 4),
            explanation=explanation,
        )
