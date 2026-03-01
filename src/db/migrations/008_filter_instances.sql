-- Many-to-many join table: which instances a filter applies to
CREATE TABLE IF NOT EXISTS filter_instances (
  filter_id   INTEGER NOT NULL REFERENCES filters(id) ON DELETE CASCADE,
  instance_id INTEGER NOT NULL REFERENCES arr_instances(id) ON DELETE CASCADE,
  PRIMARY KEY (filter_id, instance_id)
);
