CREATE TABLE IF NOT EXISTS email_verification_history (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email varchar(320) NOT NULL,
  domain varchar(255) NOT NULL,
  verdict varchar(24) NOT NULL,
  score int NOT NULL,
  provider varchar(255) NULL,
  smtp_code int NULL,
  smtp_state varchar(80) NULL,
  result json NOT NULL,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX email_history_email_idx (email, id),
  INDEX email_history_domain_idx (domain, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS verification_retries (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  result_id bigint unsigned NOT NULL,
  job_id varchar(36) NOT NULL,
  email varchar(320) NOT NULL,
  attempt int unsigned NOT NULL DEFAULT 1,
  max_attempts int unsigned NOT NULL DEFAULT 3,
  status varchar(24) NOT NULL DEFAULT 'scheduled',
  next_retry_at datetime(3) NOT NULL,
  last_error text NULL,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX verification_retries_due_idx (status, next_retry_at),
  INDEX verification_retries_job_idx (job_id),
  CONSTRAINT verification_retries_result_fk FOREIGN KEY (result_id)
    REFERENCES verification_results(id) ON DELETE CASCADE,
  CONSTRAINT verification_retries_job_fk FOREIGN KEY (job_id)
    REFERENCES verification_jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
