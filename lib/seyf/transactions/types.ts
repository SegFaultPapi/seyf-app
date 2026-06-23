export type TransactionEntityType = "deposit" | "advance" | "withdrawal";

export type TransactionType = "deposit" | "advance" | "withdrawal" | "yield";

export type TransactionStatus = "pending" | "processing" | "completed" | "failed" | "liquidated";

export type TransactionRow = {
  id: string;
  user_id: string;
  entity_type: TransactionEntityType;
  type: TransactionType;
  status: TransactionStatus;
  amount_mxn: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type TransactionListItem = TransactionRow & {
  type_label: string;
};

export type TransactionListResult = {
  transactions: TransactionListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    has_more: boolean;
  };
};

export type TransactionFilterType = "deposit" | "advance" | "withdrawal";
export type TransactionFilterStatus = "pending" | "completed" | "failed";

export type ListTransactionsInput = {
  userId: string;
  page?: number;
  limit?: number;
  type?: TransactionFilterType;
  status?: TransactionFilterStatus;
};
