export interface Car {
  id: string;
  carName: string;
  model: string;
  rentedTo: string;     // person/company the car is rented to; "" when unset
  dateRented: string;   // ISO date (YYYY-MM-DD)
  rentedTill: string;   // ISO date (YYYY-MM-DD)
  rentedPrice: number;
  advancePaid: number;
}

export type CarInput = Omit<Car, "id"> & { id?: string };

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
