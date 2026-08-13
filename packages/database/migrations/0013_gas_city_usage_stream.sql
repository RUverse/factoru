-- Active runs may have advanced gas_city_event_cursor without durably folding
-- every usage event. Replay them from dispatch under the SSE-owned cursor.
UPDATE task_runs
SET gas_city_event_cursor = starting_event_cursor,
    usage_json = json_object(
      'inputTokens', 0,
      'outputTokens', 0,
      'estimatedCostUsd', 0,
      'pricing', 'pending',
      'partial', json('true'),
      '_source', 'pending',
      '_historyGap', json('false'),
      '_streamCurrent', json('false'),
      '_transcriptPartial', json('false')
    )
WHERE kind = 'implementation' AND status IN ('running', 'cancelling');

-- Historical terminal totals cannot be proven complete because the former
-- bounded backwards walk discarded its partial signal.
UPDATE task_runs
SET usage_json = json_set(usage_json, '$.partial', json('true')),
    review_package_json = CASE
      WHEN json_type(review_package_json, '$.usage') IS NOT NULL
        THEN json_set(review_package_json, '$.usage.partial', json('true'))
      ELSE review_package_json
    END
WHERE kind = 'implementation' AND status IN ('completed', 'failed', 'cancelled');
