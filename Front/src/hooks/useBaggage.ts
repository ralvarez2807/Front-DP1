import { useState, useCallback, useEffect } from 'react';
import { baggageService } from '../services/baggageService';
import { BaggageRequest } from '../models/operational';

export function useBaggage() {
  const [baggage, setBaggage] = useState<BaggageRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAllBaggage = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await baggageService.getAll();
      setBaggage(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch baggage');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createBaggage = async (data: Partial<BaggageRequest>) => {
    try {
      const newBaggage = await baggageService.create(data);
      setBaggage(prev => [newBaggage, ...prev]);
      return newBaggage;
    } catch (err: any) {
      console.error('Failed to create baggage', err);
      throw err;
    }
  };

  useEffect(() => {
    fetchAllBaggage();
  }, [fetchAllBaggage]);

  return {
    baggage,
    isLoading,
    error,
    refresh: fetchAllBaggage,
    createBaggage
  };
}
