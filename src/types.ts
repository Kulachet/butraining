export interface Instructor {
  uid?: string;
  id: string; // Instructor ID from CSV
  name: string;
  email: string;
  position?: string;
  department: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Session {
  sessionId: string;
  sessionName: string;
  date: string;
  startTime: string;
  endTime: string;
  locationType: 'On-site' | 'Online';
  locationDetail: string;
  maxSeats: number;
  enrolledSeats: number;
}

export interface Course {
  id: string;
  title: string;
  academicYear: string;
  category?: string;
  instructorName: string;
  instructorId?: string;
  date: string;
  description: string;
  imageUrl?: string;
  bannerImageBase64?: string;
  driveFolderId?: string;
  status: 'Active' | 'Inactive';
  isVisible: boolean;
  sessions: Session[];
  totalRegistrations?: number;
  maxSeats?: number;
  enrolledSeats?: number;
  locationDetail?: string;
  startTime?: string;
  endTime?: string;
  department?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Registration {
  id: string;
  courseId: string;
  courseTitle?: string;
  sessionId?: string;
  sessionName?: string;
  userId: string;
  instructorId?: string;
  userName: string;
  userEmail: string;
  userPosition: string;
  userDepartment: string;
  sequenceNumber: number;
  checkInSequenceNumber?: number;
  checkInAt?: string;
  attended: boolean;
  registeredAt: string;
  certStatus?: 'pending' | 'sent' | 'failed';
  certSentAt?: string;
}

export interface EvaluationSummary {
  averageScore: number;
  totalResponses: number;
  scoreDistribution: { label: string; value: number }[];
}

export interface AuthContextType {
  user: any | null;
  instructor: Instructor | null;
  loading: boolean;
  isAdmin: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  registerInstructor: (data: Omit<Instructor, 'uid' | 'email' | 'createdAt'>) => Promise<void>;
}
