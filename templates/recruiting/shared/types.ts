export type GreenhouseJob = {
  id: number;
  name: string;
  status: "open" | "closed" | "draft";
  departments: { id: number; name: string }[];
  offices: { id: number; name: string }[];
  openings: { id: number; opening_id: string; status: string }[];
  hiring_team?: {
    hiring_managers: { id: number; name: string }[];
    recruiters: { id: number; name: string }[];
    coordinators: { id: number; name: string }[];
  };
  created_at: string;
  updated_at: string;
  opened_at: string;
  closed_at: string | null;
  requisition_id: string | null;
  confidential: boolean;
  notes: string | null;
};

export type GreenhouseCandidate = {
  id: number;
  first_name: string;
  last_name: string;
  company: string | null;
  title: string | null;
  emails: { value: string; type: string }[];
  phone_numbers: { value: string; type: string }[];
  addresses: { value: string; type: string }[];
  social_media_addresses: { value: string }[];
  website_addresses: { value: string; type: string }[];
  tags: string[];
  applications: GreenhouseApplication[];
  created_at: string;
  updated_at: string;
  last_activity: string;
  photo_url: string | null;
  recruiter: { id: number; name: string } | null;
  coordinator: { id: number; name: string } | null;
  is_private: boolean;
  can_email: boolean;
};

export type GreenhouseApplication = {
  id: number;
  candidate_id: number;
  prospect: boolean;
  applied_at: string;
  rejected_at: string | null;
  last_activity_at: string;
  location: { address: string } | null;
  source: { id: number; public_name: string } | null;
  credited_to: { id: number; name: string } | null;
  rejection_reason: {
    id: number;
    name: string;
    type: { id: number; name: string };
  } | null;
  jobs: { id: number; name: string }[];
  job_post_id: number | null;
  status: "active" | "rejected" | "hired";
  current_stage: { id: number; name: string } | null;
  answers: { question: string; answer: string }[];
  custom_fields: Record<string, any>;
  attachments: {
    filename: string;
    url: string;
    type: string;
    created_at: string;
  }[];
};

export type GreenhouseJobStage = {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  job_id: number;
  priority: number;
  interviews: { id: number; name: string }[];
};

export type GreenhouseScheduledInterview = {
  id: number;
  application_id: number;
  external_event_id: string | null;
  created_at: string;
  updated_at: string;
  start: { date_time: string };
  end: { date_time: string };
  location: string | null;
  status: string;
  organizer: { id: number; name: string; email: string };
  interviewers: {
    id: number;
    name: string;
    email: string;
    scorecard_id: number | null;
  }[];
};

export type GreenhouseScorecard = {
  id: number;
  candidate_id: number;
  application_id: number;
  interview: string;
  overall_recommendation: string;
  submitted_at: string;
  submitted_by: { id: number; name: string; email: string };
  attributes: {
    name: string;
    type: string;
    note: string;
    rating: string;
  }[];
};

export type GreenhouseDepartment = {
  id: number;
  name: string;
  parent_id: number | null;
  child_ids: number[];
};

export type GreenhouseOffice = {
  id: number;
  name: string;
  parent_id: number | null;
  child_ids: number[];
  location: { name: string } | null;
};

export type DashboardStats = {
  openJobs: number;
  activeCandidates: number;
  upcomingInterviews: number;
  recentApplications: GreenhouseApplication[];
};

export type PipelineStage = {
  stage: GreenhouseJobStage;
  applications: (GreenhouseApplication & {
    candidate_name: string;
    candidate_company: string | null;
  })[];
};

export type GreenhouseView =
  | "dashboard"
  | "jobs"
  | "candidates"
  | "interviews"
  | "settings";

export type NavigationState = {
  view: GreenhouseView;
  jobId?: number;
  candidateId?: number;
  applicationId?: number;
  search?: string;
  filters?: Record<string, string>;
};

export type AgentNote = {
  id: string;
  candidateId: number;
  content: string;
  type: "resume_analysis" | "comparison" | "interview_prep" | "general";
  createdAt: string;
};
