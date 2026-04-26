"""
Tiny BigQuery client wrapper.

Centralises:
  - Per-query bytes-billed cap (cost ceiling)
  - Use of cached results (free, 24h TTL)
  - Parameterised queries (no string concat → no SQL injection)
  - {project} / {dataset} placeholder substitution
"""
from __future__ import annotations

from typing import Any

from google.cloud import bigquery


class BigQueryClient:
    def __init__(self, project_id: str, dataset: str, max_bytes_billed: int) -> None:
        self.project_id = project_id
        self.dataset = dataset
        self.max_bytes_billed = max_bytes_billed
        self._client = bigquery.Client(project=project_id)

    def run_query(self, sql: str, params: dict[str, Any] | None = None) -> list[dict]:
        """
        Execute a query and return rows as plain dicts.

        Parameters
        ----------
        sql
            The SQL with `{project}` and `{dataset}` placeholders to be
            interpolated, and `@name` parameter markers for `params`.
        params
            Mapping of parameter name → Python value. Strings, ints,
            floats, booleans and timestamps are auto-typed.
        """
        query = sql.format(project=self.project_id, dataset=self.dataset)
        bq_params = [
            self._to_bq_param(name, value) for name, value in (params or {}).items()
        ]
        job_config = bigquery.QueryJobConfig(
            query_parameters=bq_params,
            use_query_cache=True,
            maximum_bytes_billed=self.max_bytes_billed,
        )
        job = self._client.query(query, job_config=job_config)
        rows = job.result()
        # Convert datetime/Decimal etc. to JSON-friendly via dict() — FastAPI
        # handles isoformat / float conversion downstream.
        return [dict(row) for row in rows]

    @staticmethod
    def _to_bq_param(name: str, value: Any) -> bigquery.ScalarQueryParameter:
        if isinstance(value, bool):
            t = "BOOL"
        elif isinstance(value, int):
            t = "INT64"
        elif isinstance(value, float):
            t = "FLOAT64"
        else:
            t = "STRING"
            value = str(value)
        return bigquery.ScalarQueryParameter(name, t, value)
