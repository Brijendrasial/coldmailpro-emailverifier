CREATE DATABASE IF NOT EXISTS email_verifier CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE email_verifier;

CREATE TABLE IF NOT EXISTS verification_jobs (
  id varchar(36) NOT NULL PRIMARY KEY,status varchar(24) NOT NULL DEFAULT 'queued',total int unsigned NOT NULL DEFAULT 0,processed int unsigned NOT NULL DEFAULT 0,deliverable int unsigned NOT NULL DEFAULT 0,risky int unsigned NOT NULL DEFAULT 0,undeliverable int unsigned NOT NULL DEFAULT 0,unknown int unsigned NOT NULL DEFAULT 0,ignore_smtp tinyint(1) NOT NULL DEFAULT 0,created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),started_at datetime(3) NULL,completed_at datetime(3) NULL,error text NULL,INDEX verification_jobs_created_idx(created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS verification_results (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,job_id varchar(36) NOT NULL,email varchar(320) NOT NULL,verdict varchar(24) NOT NULL,score int NOT NULL,provider varchar(255) NULL,catch_all tinyint(1) NULL,result json NOT NULL,created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),INDEX verification_results_job_idx(job_id,id),CONSTRAINT verification_results_job_fk FOREIGN KEY(job_id) REFERENCES verification_jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS worker_nodes (
  worker_id varchar(128) NOT NULL PRIMARY KEY,hostname varchar(255) NOT NULL,status varchar(24) NOT NULL DEFAULT 'online',current_job_id varchar(36) NULL,processed_total bigint unsigned NOT NULL DEFAULT 0,last_seen datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),started_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),INDEX worker_nodes_seen_idx(last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitored_domains (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,domain varchar(255) NOT NULL UNIQUE,enabled tinyint(1) NOT NULL DEFAULT 1,interval_minutes int unsigned NOT NULL DEFAULT 60,next_check_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),last_check_at datetime(3) NULL,last_change_at datetime(3) NULL,last_hash char(64) NULL,created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),INDEX monitored_domains_due_idx(enabled,next_check_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS domain_monitor_snapshots (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,domain_id bigint unsigned NOT NULL,domain varchar(255) NOT NULL,changed tinyint(1) NOT NULL DEFAULT 0,change_summary text NULL,snapshot json NOT NULL,created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),INDEX domain_snapshots_domain_idx(domain_id,id),CONSTRAINT domain_snapshots_fk FOREIGN KEY(domain_id) REFERENCES monitored_domains(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
