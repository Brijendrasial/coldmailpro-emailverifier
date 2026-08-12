CREATE TABLE IF NOT EXISTS ai_analysis_history (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  analysis_type varchar(24) NOT NULL,
  subject_key varchar(320) NOT NULL,
  model varchar(128) NOT NULL,
  input_ref varchar(128) NULL,
  prompt_text text NULL,
  output_json json NOT NULL,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX ai_analysis_subject_idx (subject_key,id),
  INDEX ai_analysis_type_idx (analysis_type,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
