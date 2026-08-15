ALTER TABLE `reservations` ADD `payment_refund_requester` text DEFAULT '2' NOT NULL CHECK (`payment_refund_requester` IN ('1','2'));
